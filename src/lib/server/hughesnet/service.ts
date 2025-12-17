// src/lib/server/hughesnet/service.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { makeTripService } from '../tripService';
import { HughesNetFetcher } from './fetcher';
import { HughesNetAuth } from './auth';
import { HughesNetRouter } from './router';
import * as parser from './parser';
import type { OrderData, OrderWithMeta, Trip, TripStop, SupplyItem, SyncConfig, SyncResult, DistributedLock } from './types';

// --- CONSTANTS ---
const SCAN_REQUEST_LIMIT = 15;
const DISCOVERY_GAP_LIMIT = 150;
const DISCOVERY_BACKWARD_LIMIT = 200;
const DOWNLOAD_LIMIT = 250;
const TRIP_CREATION_LIMIT = 250;
const DISCOVERY_GAP_MAX_SIZE = 50;
const DISCOVERY_MAX_FAILURES = 50;
const DISCOVERY_MAX_CHECKS = 100;
const USER_MODIFICATION_BUFFER_MS = 120000; // 2 minutes
const MIN_JOB_DURATION_MINS = 10;
const MAX_JOB_DURATION_MINS = 600;

// DELAY CONSTANTS (Issue #7)
const DELAY_BETWEEN_SCANS_MS = 150;
const DELAY_BETWEEN_GAP_FILLS_MS = 50;
const DELAY_BETWEEN_BACKWARD_SCANS_MS = 80;
const DELAY_BETWEEN_DOWNLOADS_MS = 200;

// DISTRIBUTED LOCK CONSTANTS (Issue #1)
const LOCK_TTL_MS = 300000; // 5 minutes
const LOCK_RETRY_DELAY_MS = 1000; // 1 second
const LOCK_MAX_RETRIES = 10;

// ROLLBACK CONSTANTS (Issue #7)
const MAX_ROLLBACK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// RESYNC SYSTEM CONSTANTS
const RESYNC_WINDOW_DAYS = 7;
const RESYNC_WINDOW_MS = RESYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// --- HELPERS ---

function parseDateOnly(dateStr: string): Date | null {
    if (!dateStr) return null;
    const m = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    return new Date(parseInt(y), parseInt(m[1]) - 1, parseInt(m[2]));
}

function toIsoDate(dateStr: string) {
    const d = parseDateOnly(dateStr);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function extractDateFromTs(ts: number): string | null {
    if (!ts) return null;
    const d = new Date(ts);
    return toIsoDate(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
}

function parseTime(timeStr: string): number {
    if (!timeStr) return 0;
    const match = timeStr.match(/\b(\d{1,2}:\d{2})/);
    if (!match) return 0;
    const [h, m] = match[1].split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes: number): string {
    // Safeguard against NaN
    if (!isFinite(minutes) || isNaN(minutes)) {
        return '12:00 PM'; // Default fallback
    }
    if (minutes < 0) minutes += 1440;
    let h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return minutesToTime(d.getHours() * 60 + d.getMinutes());
}

// Issue #4: Enhanced validation with Infinity check
function validateSyncConfig(config: SyncConfig): void {
    const { installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge } = config;
    
    if (!isFinite(installPay) || installPay < 0) {
        throw new Error('Install pay must be a positive finite number');
    }
    if (!isFinite(repairPay) || repairPay < 0) {
        throw new Error('Repair pay must be a positive finite number');
    }
    if (!isFinite(upgradePay) || upgradePay < 0) {
        throw new Error('Upgrade pay must be a positive finite number');
    }
    if (!isFinite(poleCost) || poleCost < 0) {
        throw new Error('Pole cost must be a positive finite number');
    }
    if (!isFinite(concreteCost) || concreteCost < 0) {
        throw new Error('Concrete cost must be a positive finite number');
    }
    if (!isFinite(poleCharge) || poleCharge < 0) {
        throw new Error('Pole charge must be a positive finite number');
    }
}

// Issue #5: Address validation with whitespace trimming
function isValidAddress(order: OrderData): boolean {
    const trimmedAddress = order.address?.trim();
    const trimmedCity = order.city?.trim();
    const trimmedState = order.state?.trim();
    
    return !!(trimmedAddress || (trimmedCity && trimmedState));
}

// RESYNC SYSTEM: Determine order sync status
function determineOrderSyncStatus(order: OrderData): {
    syncStatus: 'complete' | 'incomplete' | 'future';
    needsResync: boolean;
} {
    const now = Date.now();
    
    // Check if order is complete
    if (order.departureCompleteTimestamp) {
        return { syncStatus: 'complete', needsResync: false };
    }
    
    // Check if incomplete (has departure incomplete timestamp)
    if (order.departureIncompleteTimestamp) {
        // Only resync if within 7 days
        const withinWindow = order.lastSyncTimestamp && 
                            (now - order.lastSyncTimestamp) < RESYNC_WINDOW_MS;
        return { syncStatus: 'incomplete', needsResync: withinWindow };
    }
    
    // No departure timestamp = future job
    return { syncStatus: 'future', needsResync: true };
}

// RESYNC SYSTEM: Check if order transitioned from incomplete to complete
function checkIncompleteToComplete(
    oldOrder: OrderData | undefined, 
    newOrder: OrderData
): boolean {
    if (!oldOrder) return false;
    
    // Must have been incomplete before
    if (oldOrder.syncStatus !== 'incomplete') return false;
    
    // Must be complete now
    if (!newOrder.departureCompleteTimestamp) return false;
    
    // Must have old incomplete timestamp
    if (!oldOrder.departureIncompleteTimestamp) return false;
    
    // Must be within 7 day window
    if (!oldOrder.lastSyncTimestamp) return false;
    const daysSinceSync = (Date.now() - oldOrder.lastSyncTimestamp) / (1000 * 60 * 60 * 24);
    if (daysSinceSync > RESYNC_WINDOW_DAYS) return false;
    
    return true;
}

// RESYNC SYSTEM: Check if order should be marked as removed
function shouldMarkAsRemoved(order: OrderData): boolean {
    // Only mark as removed if it had both arrival and departure incomplete
    return !!(order.arrivalTimestamp && order.departureIncompleteTimestamp);
}

function buildAddress(o: OrderData): string {
    const parts = [o.address, o.city, o.state, o.zip]
        .filter(Boolean)
        .map(s => s.trim())
        .filter(s => s.length > 0);
    
    if (parts.length === 0) return '';
    return parts.join(', ');
}

export class HughesNetService {
    public logs: string[] = [];
    private fetcher: HughesNetFetcher;
    private auth: HughesNetAuth;
    private router: HughesNetRouter;

    constructor(
        private kv: KVNamespace, 
        encryptionKey: string,
        private logsKV: KVNamespace, 
        private trashKV: KVNamespace,
        private settingsKV: KVNamespace,
        googleApiKey: string | undefined,
        directionsKV: KVNamespace | undefined,
        private tripKV: KVNamespace,
        private tripIndexDO: DurableObjectNamespace
    ) {
        this.fetcher = new HughesNetFetcher();
        this.auth = new HughesNetAuth(kv, encryptionKey, this.fetcher);
        this.router = new HughesNetRouter(directionsKV, googleApiKey, this.fetcher);
    }

    private log(msg: string) { console.log(msg); this.logs.push(msg); }
    private warn(msg: string) { console.warn(msg); this.logs.push(`⚠️ ${msg}`); }
    private error(msg: string, e?: any) { console.error(msg, e); this.logs.push(`❌ ${msg}`); }

    // Issue #1: Distributed lock implementation using KV
    private async acquireLock(lockKey: string, ownerId: string): Promise<boolean> {
        const expiresAt = Date.now() + LOCK_TTL_MS;
        const lock: DistributedLock = { lockId: lockKey, ownerId, expiresAt };
        
        try {
            // Try to acquire lock
            await this.kv.put(lockKey, JSON.stringify(lock), {
                expirationTtl: Math.ceil(LOCK_TTL_MS / 1000)
            });
            
            // Verify we got the lock by reading it back
            const stored = await this.kv.get(lockKey);
            if (!stored) return false;
            
            const storedLock = JSON.parse(stored) as DistributedLock;
            return storedLock.ownerId === ownerId;
        } catch (e) {
            console.error('Failed to acquire lock:', e);
            return false;
        }
    }

    private async releaseLock(lockKey: string, ownerId: string): Promise<void> {
        try {
            const stored = await this.kv.get(lockKey);
            if (!stored) return;
            
            const lock = JSON.parse(stored) as DistributedLock;
            // Only release if we own the lock
            if (lock.ownerId === ownerId) {
                await this.kv.delete(lockKey);
            }
        } catch (e) {
            console.error('Failed to release lock:', e);
        }
    }

    private async waitForLock(lockKey: string, ownerId: string): Promise<boolean> {
        for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
            const acquired = await this.acquireLock(lockKey, ownerId);
            if (acquired) return true;
            
            // Check if lock is expired
            try {
                const stored = await this.kv.get(lockKey);
                if (stored) {
                    const lock = JSON.parse(stored) as DistributedLock;
                    if (lock.expiresAt < Date.now()) {
                        // Lock expired, try to clean it up
                        await this.kv.delete(lockKey);
                        continue;
                    }
                }
            } catch (e) {
                console.warn('Failed to check lock expiry:', e);
            }
            
            this.log(`[Lock] Waiting for lock... (attempt ${i + 1}/${LOCK_MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY_MS));
        }
        
        return false;
    }

    // SESSION REFRESH: Verify and refresh session if needed
    private async refreshSessionIfNeeded(userId: string): Promise<string | null> {
        this.log('[Session] Verifying session...');
        
        // Check if session exists and is valid
        const cookie = await this.auth.ensureSessionCookie(userId);
        if (!cookie) {
            throw new Error('Session expired. Please reconnect.');
        }
        
        // Verify session is still valid
        try {
            const testUrl = `${parser.BASE_URL}/start/Home.jsp`;
            const res = await this.fetcher.safeFetch(testUrl, { 
                headers: { 'Cookie': cookie }
            });
            const html = await res.text();
            
            // Check if we got logged out
            if (html.includes('name="Password"') || html.includes('login.jsp')) {
                this.error('[Session] Session expired during sync');
                throw new Error('Session expired. Please reconnect.');
            }
            
            this.log('[Session] Session valid');
            return cookie;
        } catch (e: any) {
            if (e.message === 'REQ_LIMIT') throw e;
            if (e.message.includes('Session expired')) throw e;
            this.error('[Session] Failed to verify session', e);
            throw new Error('Session validation failed. Please reconnect.');
        }
    }

    async connect(userId: string, u: string, p: string) {
        this.log(`[HNS] Connecting user ${userId}...`);
        return this.auth.connect(userId, u, p);
    }

    async disconnect(userId: string) {
        return this.auth.disconnect(userId);
    }

    async getOrders(userId: string) {
        const dbRaw = await this.kv.get(`hns:db:${userId}`);
        return dbRaw ? JSON.parse(dbRaw) : {};
    }

    async clearAllTrips(userId: string) {
        const tripService = makeTripService(this.tripKV, this.trashKV, undefined, this.tripIndexDO);
        const allTrips = await tripService.list(userId);
        let count = 0;
        for (const trip of allTrips) {
            if (trip.id.startsWith('hns_') || trip.notes?.includes('HNS')) {
                await tripService.delete(userId, trip.id);
                count++;
            }
        }
        await this.kv.delete(`hns:db:${userId}`);
        return count;
    }

    // Get Settings from KV
    async getSettings(userId: string) {
        try {
            const raw = await this.kv.get(`hns:settings:${userId}`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            this.error('Failed to retrieve settings', e);
            return null;
        }
    }

    // Save Settings to KV
    async saveSettings(userId: string, settings: any) {
        try {
            // Re-use existing validation logic
            validateSyncConfig({
                installPay: settings.installPay,
                repairPay: settings.repairPay,
                upgradePay: settings.upgradePay,
                poleCost: settings.poleCost,
                concreteCost: settings.concreteCost,
                poleCharge: settings.poleCharge
            });

            // Add manual validation for times
            if (settings.installTime < 0 || settings.repairTime < 0) {
                throw new Error("Job times cannot be negative");
            }

            // Save to KV using consistent key format
            await this.kv.put(`hns:settings:${userId}`, JSON.stringify(settings));
            return true;
        } catch (e) {
            this.error('Failed to save settings', e);
            throw e;
        }
    }

    async sync(
        userId: string, 
        settingsId: string | undefined, 
        installPay: number, 
        repairPay: number, 
        upgradePay: number,      
        poleCost: number, 
        concreteCost: number, 
        poleCharge: number,
        skipScan: boolean
    ): Promise<SyncResult> {
        // Validate input
        validateSyncConfig({ installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge });

        // Issue #1 & #2: Distributed lock with proper cleanup
        const lockKey = `lock:sync:${userId}`;
        const ownerId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        let lockAcquired = false;
        try {
            lockAcquired = await this.waitForLock(lockKey, ownerId);
            if (!lockAcquired) {
                throw new Error('Could not acquire sync lock. Another sync may be in progress.');
            }

            const result = await this.performSync(
                userId, settingsId, installPay, repairPay, upgradePay, 
                poleCost, concreteCost, poleCharge, skipScan
            );
            
            return result;
        } finally {
            // Issue #2: Guaranteed cleanup even if performSync throws
            if (lockAcquired) {
                await this.releaseLock(lockKey, ownerId);
            }
        }
    }

    private async performSync(
        userId: string, 
        settingsId: string | undefined, 
        installPay: number, 
        repairPay: number, 
        upgradePay: number,      
        poleCost: number, 
        concreteCost: number, 
        poleCharge: number,
        skipScan: boolean
    ): Promise<SyncResult> {
        this.fetcher.resetCount();
        this.log(`[Config] Install: $${installPay} | Repair: $${repairPay} | Upgrade: $${upgradePay}`);

        let cookie = await this.auth.ensureSessionCookie(userId);
        if (!cookie) throw new Error('Could not login. Please reconnect.');

        let orderDb: Record<string, OrderData> = {};
        const dbRaw = await this.kv.get(`hns:db:${userId}`);
        if (dbRaw) {
            try {
                orderDb = JSON.parse(dbRaw);
            } catch (e) {
                // Issue #8: Handle corrupt JSON gracefully
                this.error('[Sync] Failed to parse existing order database, starting fresh', e);
                orderDb = {};
            }
        }
        
        // Issue #7: Memory-efficient rollback
        let originalDbState: string | null = null;
        const dbString = JSON.stringify(orderDb);
        if (dbString.length < MAX_ROLLBACK_SIZE_BYTES) {
            originalDbState = dbString;
        } else {
            this.warn(`[Sync] Order database too large (${(dbString.length / 1024 / 1024).toFixed(2)}MB), rollback disabled`);
        }
        
        let dbDirty = false;
        let incomplete = false;
        
        try {
            // STAGE 1: SCANNING
            if (!skipScan) {
                try {
                    const res = await this.fetcher.safeFetch(parser.BASE_URL + '/start/Home.jsp', { headers: { 'Cookie': cookie }});
                    const html = await res.text();
                    if (html.includes('name="Password"')) throw new Error('Session expired.');
                    
                    parser.extractIds(html).forEach(id => {
                        if (!orderDb[id]) { 
                            orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; 
                            dbDirty = true; 
                        }
                    });

                    if (this.fetcher.getRequestCount() < 10) {
                        const links = parser.extractMenuLinks(html).filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));
                        this.log(`[Scan] Found ${links.length} pages...`);
                        
                        for (const link of links) {
                            if (this.fetcher.getRequestCount() > SCAN_REQUEST_LIMIT) break; 
                            await this.scanUrl(link.url, cookie, (id) => {
                                 if (!orderDb[id]) { 
                                     orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; 
                                     dbDirty = true; 
                                 }
                            });
                            await new Promise(r => setTimeout(r, DELAY_BETWEEN_SCANS_MS));
                        }
                    }
                } catch (e: any) {
                    if (e.message !== 'REQ_LIMIT') this.error('[Scan] Error', e);
                }
            }

            // STAGE 1.5: SMART DISCOVERY
            const knownIds = Object.keys(orderDb).map(id => parseInt(id)).filter(n => !isNaN(n)).sort((a,b) => a - b);
            if (knownIds.length > 0 && !skipScan) {
                // Refresh session before discovery
                cookie = await this.refreshSessionIfNeeded(userId);
                
                const minId = knownIds[0];
                
                const tryFetchId = async (targetId: number) => {
                      if (orderDb[String(targetId)] || this.fetcher.getRequestCount() >= DISCOVERY_BACKWARD_LIMIT) return false; 

                      try {
                        const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${targetId}`;
                        const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                        const html = await res.text();
                        const parsed = parser.parseOrderPage(html, String(targetId));
                        if (parsed.address) {
                            delete parsed._status;
                            orderDb[String(targetId)] = parsed;
                            dbDirty = true;
                            return true;
                        }
                      } catch(e) {
                        console.warn(`Failed to fetch order ${targetId}:`, e);
                      }
                      return false;
                };

                this.log(`[Discovery] Checking gaps and backward scan...`);

                // Fill gaps
                for (let i = 0; i < knownIds.length - 1; i++) {
                    if (this.fetcher.getRequestCount() >= DISCOVERY_GAP_LIMIT) break;
                    const current = knownIds[i];
                    const next = knownIds[i+1];
                    if (next - current > 1 && next - current < DISCOVERY_GAP_MAX_SIZE) {
                        for (let j = current + 1; j < next; j++) {
                            await tryFetchId(j);
                            await new Promise(r => setTimeout(r, DELAY_BETWEEN_GAP_FILLS_MS));
                        }
                    }
                }

                // Backward scan
                let failures = 0, current = minId - 1, checks = 0;
                while(failures < DISCOVERY_MAX_FAILURES && checks < DISCOVERY_MAX_CHECKS) { 
                      const found = await tryFetchId(current);
                      if (found) failures = 0; else failures++;
                      current--;
                      checks++;
                      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BACKWARD_SCANS_MS));
                }
            }

            // STAGE 2: DOWNLOAD DETAILS
            const missingDataIds = Object.values(orderDb)
                .filter((o:OrderData) => (o._status === 'pending' || !o.address) && o._status !== 'failed')
                .map((o:OrderData) => o.id);
            
            if (missingDataIds.length > 0) {
                // Refresh session before downloads
                cookie = await this.refreshSessionIfNeeded(userId);
                
                this.log(`[Download] Getting ${missingDataIds.length} orders...`);
                for (const id of missingDataIds) {
                    if (this.fetcher.getRequestCount() >= DOWNLOAD_LIMIT) {
                        incomplete = true;
                        this.warn(`[Limit] Paused. Resume next sync.`);
                        break;
                    }

                    try {
                        const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                        const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                        const html = await res.text();
                        const parsed = parser.parseOrderPage(html, id);
                        
                        if (parsed.address && (parsed.confirmScheduleDate || parsed.arrivalTimestamp)) {
                            const existingOrder = orderDb[id];
                            
                            // Determine sync status
                            const { syncStatus, needsResync } = determineOrderSyncStatus(parsed);
                            
                            // Check for incomplete→complete transition
                            const wasIncompleteNowComplete = checkIncompleteToComplete(existingOrder, parsed);
                            
                            // Update order with sync tracking
                            delete parsed._status;
                            const updatedOrder: OrderData = {
                                ...parsed,
                                syncStatus,
                                needsResync,
                                lastSyncTimestamp: Date.now()
                            };
                            
                            // If incomplete→complete, mark for payment update
                            if (wasIncompleteNowComplete) {
                                updatedOrder.lastPaymentUpdate = Date.now();
                                this.log(`  ${id} [INCOMPLETE→COMPLETE] Payment update needed`);
                            }
                            
                            orderDb[id] = updatedOrder;
                            dbDirty = true;
                            
                            const ts = parsed.arrivalTimestamp ? `Arr:${formatTimestamp(parsed.arrivalTimestamp)}` : '';
                            const pole = parsed.hasPoleMount ? '+POLE' : '';
                            const status = syncStatus === 'future' ? '[FUTURE]' : syncStatus === 'incomplete' ? '[INCOMPLETE]' : '';
                            this.log(`  ${id} ${ts} ${pole} ${status}`.trim());
                        } else if (!parsed.address) {
                            orderDb[id]._status = 'failed';
                            dbDirty = true;
                        }
                        await new Promise(r => setTimeout(r, DELAY_BETWEEN_DOWNLOADS_MS)); 
                    } catch (e: any) {
                        if (e.message === 'REQ_LIMIT') { 
                            incomplete = true; 
                            break; 
                        }
                        console.warn(`Failed to download order ${id}:`, e);
                    }
                }
                if (dbDirty) await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
            }

            if (incomplete) {
                return { orders: Object.values(orderDb), incomplete: true };
            }

            // STAGE 3: CREATE TRIPS
            // Refresh session before trip creation
            const sortedDates = Object.keys(this.groupOrdersByDate(orderDb)).sort();
            if (sortedDates.length > 0) {
                cookie = await this.refreshSessionIfNeeded(userId);
            }
            
            this.log(`[Trips] Building routes...`);
            
            const ordersByDate = this.groupOrdersByDate(orderDb);
            const tripService = makeTripService(this.tripKV, this.trashKV, undefined, this.tripIndexDO);

            for (const date of sortedDates) {
                 if (this.fetcher.getRequestCount() >= TRIP_CREATION_LIMIT) { incomplete = true; break; }

                const tripId = `hns_${userId}_${date}`;
                const existingTrip = await tripService.get(userId, tripId);
                
                if (existingTrip) {
                    const lastSys = new Date(existingTrip.updatedAt || existingTrip.createdAt).getTime();
                    const lastUser = existingTrip.lastModified ? new Date(existingTrip.lastModified).getTime() : 0;
                    if (lastUser > lastSys + USER_MODIFICATION_BUFFER_MS) {
                        this.log(`  ${date}: Skipped (user modified)`);
                        continue;
                    }
                }

                await this.createTripForDate(
                    userId, date, ordersByDate[date], settingsId,
                    installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, tripService
                );
            }

            return { orders: Object.values(orderDb), incomplete };
            
        } catch (error) {
            // Issue #8: Enhanced rollback
            if (originalDbState) {
                this.error('[Sync] Critical error occurred, attempting rollback', error);
                try {
                    JSON.parse(originalDbState);
                    await this.kv.put(`hns:db:${userId}`, originalDbState);
                    this.log('[Sync] Rollback successful');
                } catch (rollbackError) {
                    this.error('[Sync] Rollback failed - original state may be corrupt', rollbackError);
                }
            } else {
                this.error('[Sync] Critical error occurred, rollback not available (database too large)', error);
            }
            throw error;
        }
    }

    private groupOrdersByDate(orderDb: Record<string, OrderData>): Record<string, OrderData[]> {
        const ordersByDate: Record<string, OrderData[]> = {};
        
        for (const order of Object.values(orderDb)) {
            if (!isValidAddress(order)) {
                this.warn(`[Trips] Skipping order ${order.id} - invalid address`);
                continue;
            }
            
            let isoDate = toIsoDate(order.confirmScheduleDate);
            if (!isoDate && order.arrivalTimestamp) isoDate = extractDateFromTs(order.arrivalTimestamp);
            if (isoDate) {
                if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
                ordersByDate[isoDate].push(order);
            }
        }
        
        return ordersByDate;
    }

    private async scanUrl(url: string, cookie: string, cb: (id: string) => void) {
        let current = url;
        let page = 0;
        while(current && page < 5) {
            try {
                const res = await this.fetcher.safeFetch(current, { headers: { 'Cookie': cookie } });
                const html = await res.text();
                parser.extractIds(html).forEach(cb);
                current = parser.extractNextLink(html, current) || '';
                page++;
            } catch(e) { 
                console.warn('Failed to scan URL:', url, e);
                break; 
            }
        }
    }

    private async createTripForDate(
        userId: string, 
        date: string, 
        orders: OrderData[], 
        settingsId: string | undefined, 
        installPay: number, 
        repairPay: number, 
        upgradePay: number,
        poleCost: number, 
        concreteCost: number, 
        poleCharge: number,
        tripService: any
    ): Promise<boolean> {
        let defaultStart = '', defaultEnd = '', mpg = 25, gas = 3.50;
        
        try {
            const key = `settings:${settingsId || userId}`;
            const sRaw = await this.settingsKV.get(key);
            if (sRaw) {
                const d = JSON.parse(sRaw);
                const s = d.settings || d; 
                defaultStart = s.defaultStartAddress || '';
                defaultEnd = s.defaultEndAddress || '';
                if (s.defaultMPG) mpg = parseFloat(s.defaultMPG);
                if (s.defaultGasPrice) gas = parseFloat(s.defaultGasPrice);
            }
        } catch(e) {
            console.warn('Failed to load settings:', e);
        }

        const ordersWithMeta: OrderWithMeta[] = orders.map((o: OrderData): OrderWithMeta => {
            let sortTime = o.arrivalTimestamp || 0;
            if (!sortTime) {
                let dateObj = parseDateOnly(o.confirmScheduleDate) || parseDateOnly(date);
                if (dateObj) sortTime = dateObj.getTime() + (parseTime(o.beginTime) * 60000);
            }

            // Pay Logic for Future Jobs
            // 1. If explicit incomplete -> No pay
            // 2. If complete -> Pay
            // 3. If neither (Future) -> Estimate Pay
            const isPaid = !o.departureIncompleteTimestamp;

            // Calculate actual duration based on timestamps
            let actualDuration: number;
            
            // Prioritize Departure Incomplete over Departure Complete for time calculations
            const endTs = o.departureIncompleteTimestamp || o.departureCompleteTimestamp;

            if (o.arrivalTimestamp && endTs) {
                // Use actual time
                const dur = Math.round((endTs - o.arrivalTimestamp) / 60000);
                if (dur > MIN_JOB_DURATION_MINS && dur < MAX_JOB_DURATION_MINS) {
                    actualDuration = dur;
                } else {
                    // Invalid duration, fall back to type-based default
                    actualDuration = o.type === 'Install' ? 90 : 60;
                }
            } else {
                // Future jobs / Missing timestamps -> use type-based default
                // Install: 90 mins, Repair/Upgrade: 60 mins
                actualDuration = o.type === 'Install' ? 90 : 60;
            }

            return { ...o, _sortTime: sortTime, _isPaid: isPaid, _actualDuration: actualDuration };
        });

        ordersWithMeta.sort((a, b) => a._sortTime - b._sortTime);

        // RESYNC SYSTEM: Check if any orders just transitioned incomplete→complete
        const hasPaymentUpdates = ordersWithMeta.some(o => 
            o.lastPaymentUpdate && 
            (Date.now() - o.lastPaymentUpdate) < 60000 // Within last minute
        );

        if (hasPaymentUpdates) {
            this.log(`[Trip ${date}] Payment updates detected - recalculating earnings`);
        }

        const anchorOrder = ordersWithMeta.find(o => o._sortTime > 0) || ordersWithMeta[0];

        let startAddr = defaultStart?.trim() || '';
        let endAddr = defaultEnd?.trim() || '';

        if (startAddr && !endAddr) endAddr = startAddr;
        if (!startAddr && anchorOrder) {
            startAddr = buildAddress(anchorOrder);
            if (!startAddr) {
                this.warn(`[Trip ${date}] Cannot build valid start address`);
                return false;
            }
            if (!endAddr) endAddr = startAddr;
        }

        let startMins = 9 * 60; 
        let commuteMins = 0;

        if (anchorOrder) {
            const eAddr = buildAddress(anchorOrder);
            if (!eAddr) {
                this.warn(`[Trip ${date}] Cannot build valid address for anchor order`);
                return false;
            }
            
            if (startAddr && eAddr !== startAddr) {
                try {
                    const leg = await this.router.getRouteInfo(startAddr, eAddr);
                    if (leg && leg.duration && isFinite(leg.duration)) {
                        commuteMins = Math.round(leg.duration / 60);
                    }
                } catch(e) {
                    console.warn('Failed to get route info:', e);
                }
            }
            
            // Ensure commuteMins is valid
            if (isNaN(commuteMins) || !isFinite(commuteMins) || commuteMins < 0) {
                commuteMins = 0;
            }

            if (anchorOrder.arrivalTimestamp) {
                const d = new Date(anchorOrder.arrivalTimestamp);
                const arrivalMins = d.getHours() * 60 + d.getMinutes();
                if (!isNaN(arrivalMins) && isFinite(arrivalMins)) {
                    const calculatedStart = arrivalMins - commuteMins;
                    if (!isNaN(calculatedStart) && isFinite(calculatedStart)) {
                        startMins = calculatedStart;
                    }
                }
            } else {
                const schedMins = parseTime(anchorOrder.beginTime);
                if (schedMins > 0 && isFinite(schedMins)) {
                    const calculatedStart = schedMins - commuteMins;
                    if (!isNaN(calculatedStart) && isFinite(calculatedStart)) {
                        startMins = calculatedStart;
                    }
                }
            }
        }
        
        // Ensure startMins is valid and positive
        if (isNaN(startMins) || !isFinite(startMins) || startMins < 0 || startMins > 1440) {
            startMins = 9 * 60; // Fallback to 9 AM
        }

        const points: string[] = [startAddr];
        for (const o of ordersWithMeta) {
            const addr = buildAddress(o);
            if (addr) points.push(addr);
        }
        // Issue #6: Validate endAddr
        if (endAddr && endAddr.trim()) {
            points.push(endAddr);
        }

        let totalMins = 0, totalMeters = 0;
        const legPromises = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            if (points[i] !== points[i+1]) {
                legPromises.push(this.router.getRouteInfo(points[i], points[i+1])); 
            } else {
                legPromises.push(Promise.resolve(null));
            }
        }

        try {
            const results = await Promise.all(legPromises);
            results.forEach((leg) => {
                if (leg && leg.duration && isFinite(leg.duration)) {
                    const mins = Math.round(leg.duration / 60);
                    if (isFinite(mins) && mins >= 0) {
                        totalMins += mins;
                    }
                }
                if (leg && leg.distance && isFinite(leg.distance)) {
                    const meters = leg.distance;
                    if (isFinite(meters) && meters >= 0) {
                        totalMeters += meters;
                    }
                }
            });
        } catch (e: any) {
            if (e.message === 'REQ_LIMIT') return false;
            console.warn('Failed to get route legs:', e);
        }
        
        // Validate totalMins
        if (isNaN(totalMins) || !isFinite(totalMins) || totalMins < 0) {
            this.warn(`[Trip ${date}] Invalid totalMins: ${totalMins}, resetting to 0`);
            totalMins = 0;
        }

        const miles = Number((totalMeters * 0.000621371).toFixed(1));
        const jobMins = ordersWithMeta.reduce((sum, o) => {
            const dur = o._actualDuration || o.jobDuration || 60;
            if (isFinite(dur) && dur > 0) {
                return sum + dur;
            }
            return sum;
        }, 0);
        
        // Validate jobMins
        if (isNaN(jobMins) || !isFinite(jobMins) || jobMins < 0) {
            this.warn(`[Trip ${date}] Invalid jobMins: ${jobMins}`);
            return false;
        }
        
        const totalWorkMins = totalMins + jobMins;
        
        // Ensure totalWorkMins is valid
        if (isNaN(totalWorkMins) || !isFinite(totalWorkMins) || totalWorkMins < 0) {
            this.warn(`[Trip ${date}] Invalid totalWorkMins calculated: ${totalWorkMins}`);
            return false;
        }
        
        const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
        const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

        let totalEarnings = 0; 
        let totalSuppliesCost = 0;
        const suppliesMap = new Map<string, number>();

        const stops: TripStop[] = ordersWithMeta.map((o: OrderWithMeta, i: number): TripStop => {
            let basePay = 0;
            let notes = `HNS #${o.id} (${o.type})`;
            let supplyItems: { type: string, cost: number }[] = [];
            
            if (!o._isPaid) {
                // Didn't complete the job - no pay, but time still counts
                notes += ` [INCOMPLETE: $0]`;
            } else {
                if (o.hasPoleMount) {
                    basePay = installPay + poleCharge;
                    notes += ` [POLE: $${poleCharge}]`;
                    if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
                    if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
                } else {
                    if (o.type === 'Install') basePay = installPay;
                    else if (o.type === 'Upgrade') basePay = upgradePay;
                    else basePay = repairPay;
                }
            }

            totalEarnings += basePay;

            if (supplyItems.length > 0) {
                supplyItems.forEach(item => {
                    suppliesMap.set(item.type, (suppliesMap.get(item.type) || 0) + item.cost);
                    totalSuppliesCost += item.cost;
                });
            }

            return {
                id: crypto.randomUUID(),
                address: buildAddress(o),
                order: i,
                notes,
                earnings: basePay,
                appointmentTime: o.beginTime,
                type: o.type,
                duration: o._actualDuration || o.jobDuration
            };
        });

        const tripSupplies: SupplyItem[] = Array.from(suppliesMap.entries()).map(([type, cost]): SupplyItem => ({
            id: crypto.randomUUID(), 
            type, 
            cost
        }));

        const netProfit = totalEarnings - (fuelCost + totalSuppliesCost);

        const trip: Trip = {
            id: `hns_${userId}_${date}`, 
            userId, 
            date,
            startTime: minutesToTime(startMins),
            endTime: minutesToTime(startMins + totalWorkMins),
            estimatedTime: totalMins,
            totalTime: `${Math.floor(totalMins/60)}h ${totalMins%60}m`,
            hoursWorked,
            startAddress: startAddr,
            endAddress: endAddr,
            totalMiles: miles,
            mpg, 
            gasPrice: gas,
            fuelCost: Number(fuelCost.toFixed(2)),
            totalEarnings, 
            netProfit: Number(netProfit.toFixed(2)),
            suppliesCost: totalSuppliesCost,
            supplyItems: tripSupplies,
            stops,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced'
        };

        await tripService.put(trip);
        this.log(`  ${date}: $${totalEarnings} - $${(fuelCost + totalSuppliesCost).toFixed(2)} = $${netProfit.toFixed(2)} (${hoursWorked}h)`);
        
        return true;
    }
}