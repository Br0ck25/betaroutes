// src/lib/server/hughesnet/service.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { makeTripService } from '../tripService';
import { HughesNetFetcher } from './fetcher';
import { HughesNetAuth } from './auth';
import { HughesNetRouter } from './router';
import * as parser from './parser';
import type { OrderData, OrderWithMeta, Trip, TripStop, SupplyItem, SyncConfig, SyncResult, DistributedLock } from './types';

// --- CONSTANTS ---
// No per-stage limits - we check the fetcher's soft/hard limits instead
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
    const { installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, wifiExtenderPay, voipPay, driveTimeBonus } = config;
    
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
    if (!isFinite(wifiExtenderPay) || wifiExtenderPay < 0) {
        throw new Error('WiFi Extender pay must be a positive finite number');
    }
    if (!isFinite(voipPay) || voipPay < 0) {
        throw new Error('Phone pay must be a positive finite number');
    }
    if (!isFinite(driveTimeBonus) || driveTimeBonus < 0) {
        throw new Error('Drive Time Bonus must be a positive finite number');
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
    private lastSessionRefresh: number = 0;
    private sessionRefreshInterval: number = 10 * 60 * 1000; // 10 minutes
    private requestsSinceRefresh: number = 0;
    private requestsBeforeRefresh: number = 20; // Refresh every 20 requests

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
            this.lastSessionRefresh = Date.now();
            this.requestsSinceRefresh = 0;
            return cookie;
        } catch (e: any) {
            if (e.message === 'REQ_LIMIT') throw e;
            if (e.message.includes('Session expired')) throw e;
            this.error('[Session] Failed to verify session', e);
            throw new Error('Session validation failed. Please reconnect.');
        }
    }

    // PROACTIVE SESSION REFRESH: Check if we should refresh based on time or requests
    private shouldRefreshSession(): boolean {
        const timeSinceRefresh = Date.now() - this.lastSessionRefresh;
        const timeExpired = timeSinceRefresh > this.sessionRefreshInterval;
        const requestsExpired = this.requestsSinceRefresh >= this.requestsBeforeRefresh;
        
        return timeExpired || requestsExpired;
    }

    // MAYBE REFRESH: Conditionally refresh if criteria met
    private async maybeRefreshSession(userId: string, currentCookie: string): Promise<string> {
        if (this.shouldRefreshSession()) {
            this.log(`[Session] Proactive refresh (${Math.round((Date.now() - this.lastSessionRefresh) / 1000)}s elapsed, ${this.requestsSinceRefresh} requests)`);
            try {
                const newCookie = await this.refreshSessionIfNeeded(userId);
                return newCookie || currentCookie;
            } catch (e) {
                this.warn('[Session] Refresh failed, continuing with current cookie');
                return currentCookie;
            }
        }
        this.requestsSinceRefresh++;
        return currentCookie;
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
                poleCharge: settings.poleCharge,
                wifiExtenderPay: settings.wifiExtenderPay,
                voipPay: settings.voipPay,
                driveTimeBonus: settings.driveTimeBonus 
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
        wifiExtenderPay: number,
        voipPay: number,
        driveTimeBonus: number, 
        skipScan: boolean,
        recentOnly: boolean = false,
        forceDates: string[] = [] // [!code ++] New parameter
    ): Promise<SyncResult> {
        // Validate input
        validateSyncConfig({ installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, wifiExtenderPay, voipPay, driveTimeBonus });

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
                poleCost, concreteCost, poleCharge, wifiExtenderPay, voipPay, 
                driveTimeBonus, skipScan, recentOnly, forceDates // [!code ++] Pass param
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
        wifiExtenderPay: number,
        voipPay: number, 
        driveTimeBonus: number,
        skipScan: boolean,
        recentOnly: boolean,
        forceDates: string[] // [!code ++] New parameter
    ): Promise<SyncResult> {
        this.fetcher.resetCount();
        this.lastSessionRefresh = Date.now();
        this.requestsSinceRefresh = 0;
        this.log(`[Config] Install: $${installPay} | Repair: $${repairPay} | Upgrade: $${upgradePay} | WiFi: $${wifiExtenderPay} | Phone: $${voipPay} | Drive Bonus: $${driveTimeBonus}`);

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
        let conflicts: string[] = []; // [!code ++] Track conflicts
        
        try {
            // STAGE 1: SCANNING
            if (!skipScan) {
                this.log('[Scan] Starting scan phase...');
                
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

                    // Check soft limit before scanning menu links
                    if (this.fetcher.shouldBatch()) {
                        this.log(`[Scan] Soft limit reached (${this.fetcher.getRequestCount()}/${this.fetcher.getSoftLimit()}), will batch`);
                        if (dbDirty) await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
                        return { orders: Object.values(orderDb), incomplete: true };
                    }

                    const links = parser.extractMenuLinks(html).filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));

                    // [!code ++] Add manual search link to ensure it is always scanned
                    links.push({
                        url: 'https://dwayinstalls.hns.com/CROF/SoSearch.jsp?action=submit',
                        text: 'Manual Search'
                    });

                    this.log(`[Scan] Found ${links.length} menu links to scan...`);
                    
                    for (const link of links) {
                        // Check soft limit before each link scan
                        if (this.fetcher.shouldBatch()) {
                            this.log(`[Scan] Soft limit reached, saving progress and batching`);
                            break;
                        }
                        
                        // Proactively refresh session if needed
                        cookie = await this.maybeRefreshSession(userId, cookie);
                        
                        try {
                            await this.scanUrl(link.url, cookie, (id) => {
                                 if (!orderDb[id]) { 
                                     orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; 
                                     dbDirty = true; 
                                 }
                            });
                            await new Promise(r => setTimeout(r, DELAY_BETWEEN_SCANS_MS));
                        } catch (e: any) {
                            if (e.message === 'REQ_LIMIT') {
                                this.warn('[Scan] Hard limit reached');
                                break;
                            }
                            this.warn(`[Scan] Failed to scan ${link.url}: ${e.message}`);
                        }
                    }
                } catch (e: any) {
                    if (e.message === 'REQ_LIMIT') {
                        this.warn('[Scan] Hard limit reached during initial scan');
                    } else if (e.message !== 'Session expired.') {
                        this.error('[Scan] Error', e);
                    } else {
                        throw e; // Re-throw session errors
                    }
                }
                
                // Save any pending changes from scanning
                if (dbDirty) {
                    await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
                    dbDirty = false;
                }
                
                // Check if we should batch after scanning
                if (this.fetcher.shouldBatch()) {
                    this.log(`[Scan] Completed with ${this.fetcher.getRequestCount()} requests, batching`);
                    return { orders: Object.values(orderDb), incomplete: true };
                }
            }

            // STAGE 1.5: SMART DISCOVERY
            const knownIds = Object.keys(orderDb).map(id => parseInt(id)).filter(n => !isNaN(n)).sort((a,b) => a - b);
            if (knownIds.length > 0 && !skipScan) {
                this.log('[Discovery] Starting discovery phase...');
                
                // Check soft limit before discovery
                if (this.fetcher.shouldBatch()) {
                    this.log(`[Discovery] Soft limit reached before discovery, batching`);
                    return { orders: Object.values(orderDb), incomplete: true };
                }
                
                // Refresh session before discovery
                try {
                    cookie = await this.refreshSessionIfNeeded(userId);
                } catch (e: any) {
                    this.error('[Discovery] Session refresh failed', e);
                    throw e;
                }
                
                const minId = knownIds[0];
                
                const tryFetchId = async (targetId: number) => {
                      if (orderDb[String(targetId)]) return false;
                      
                      // Check soft limit before each fetch
                      if (this.fetcher.shouldBatch()) return false;
                      
                      // Proactively refresh session if needed
                      cookie = await this.maybeRefreshSession(userId, cookie);

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
                      } catch(e: any) {
                        if (e.message === 'REQ_LIMIT') return false;
                        console.warn(`Failed to fetch order ${targetId}:`, e);
                      }
                      return false;
                };

                try {
                    // Fill gaps
                    this.log('[Discovery] Filling gaps...');
                    for (let i = 0; i < knownIds.length - 1; i++) {
                        if (this.fetcher.shouldBatch()) {
                            this.log('[Discovery] Soft limit reached during gap filling');
                            break;
                        }
                        
                        const current = knownIds[i];
                        const next = knownIds[i+1];
                        if (next - current > 1 && next - current < DISCOVERY_GAP_MAX_SIZE) {
                            for (let j = current + 1; j < next; j++) {
                                const found = await tryFetchId(j);
                                if (!found && this.fetcher.shouldBatch()) break;
                                await new Promise(r => setTimeout(r, DELAY_BETWEEN_GAP_FILLS_MS));
                            }
                        }
                    }

                    // Backward scan
                    // SKIP backward scan if recentOnly is true
                    if (!this.fetcher.shouldBatch() && !recentOnly) {
                        this.log('[Discovery] Scanning backward...');
                        let failures = 0, current = minId - 1, checks = 0;
                        while(failures < DISCOVERY_MAX_FAILURES && checks < DISCOVERY_MAX_CHECKS) { 
                              if (this.fetcher.shouldBatch()) {
                                  this.log('[Discovery] Soft limit reached during backward scan');
                                  break;
                              }
                              const found = await tryFetchId(current);
                              if (found) failures = 0; else failures++;
                              current--;
                              checks++;
                              await new Promise(r => setTimeout(r, DELAY_BETWEEN_BACKWARD_SCANS_MS));
                        }
                    } else if (recentOnly) {
                        this.log('[Discovery] Skipping backward scan (Quick Sync active)');
                    }
                } catch (e: any) {
                    if (e.message === 'REQ_LIMIT') {
                        this.warn('[Discovery] Hard limit reached');
                    } else {
                        this.error('[Discovery] Unexpected error', e);
                    }
                }
                
                // Save any pending changes from discovery
                if (dbDirty) {
                    await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
                    dbDirty = false;
                }
                
                // Check if we should batch after discovery
                if (this.fetcher.shouldBatch()) {
                    this.log(`[Discovery] Completed with ${this.fetcher.getRequestCount()} requests, batching`);
                    return { orders: Object.values(orderDb), incomplete: true };
                }
            }

            // STAGE 1.5.5: RECALCULATE RESYNC STATUS
            // Before downloading, check which existing orders need resyncing
            const now = Date.now();
            let resyncCount = 0;
            
            for (const order of Object.values(orderDb)) {
                // Skip if already pending download or failed
                if (order._status === 'pending' || order._status === 'failed') continue;
                
                // Skip if no address (will be downloaded anyway)
                if (!order.address) continue;
                
                // Determine if this order needs resyncing
                const { needsResync } = determineOrderSyncStatus(order);
                
                if (needsResync && !order.needsResync) {
                    order.needsResync = true;
                    dbDirty = true;
                    resyncCount++;
                }
            }
            
            if (resyncCount > 0) {
                this.log(`[Resync] Flagged ${resyncCount} orders for resync (future jobs or incomplete within 7 days)`);
                if (dbDirty) {
                    await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
                    dbDirty = false;
                }
            }

            // STAGE 2: DOWNLOAD DETAILS
            // Get orders that need downloading or resyncing
            const missingDataIds = Object.values(orderDb)
                .filter((o: OrderData) => {
                    // Skip failed orders
                    if (o._status === 'failed') return false;
                    
                    // Download if pending or missing address
                    if (o._status === 'pending' || !o.address) return true;
                    
                    // Resync if flagged (future jobs or incomplete within 7 days)
                    if (o.needsResync) return true;
                    
                    return false;
                })
                .map((o: OrderData) => o.id);
            
            if (missingDataIds.length > 0) {
                this.log(`[Download] Starting download of ${missingDataIds.length} orders (includes ${
                    Object.values(orderDb).filter(o => o.needsResync).length
                } resyncs)...`);
                
                // Check soft limit before downloads
                if (this.fetcher.shouldBatch()) {
                    this.log(`[Download] Soft limit reached before downloads, batching`);
                    return { orders: Object.values(orderDb), incomplete: true };
                }
                
                // Refresh session before downloads
                try {
                    cookie = await this.refreshSessionIfNeeded(userId);
                } catch (e: any) {
                    this.error('[Download] Session refresh failed', e);
                    throw e;
                }
                
                for (const id of missingDataIds) {
                    // Check soft limit before each download
                    if (this.fetcher.shouldBatch()) {
                        this.log(`[Download] Soft limit reached, ${missingDataIds.length - missingDataIds.indexOf(id)} orders remaining`);
                        incomplete = true;
                        break;
                    }

                    // Proactively refresh session if needed (time or request-based)
                    cookie = await this.maybeRefreshSession(userId, cookie);

                    try {
                        const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                        const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                        const html = await res.text();
                        
                        // Check for session expiration in response
                        if (html.includes('name="Password"') || html.includes('login.jsp')) {
                            this.error('[Download] Session expired, attempting refresh...');
                            cookie = await this.refreshSessionIfNeeded(userId);
                            // Retry this order
                            const retryRes = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                            const retryHtml = await retryRes.text();
                            if (retryHtml.includes('name="Password"')) {
                                throw new Error('Session expired. Please reconnect.');
                            }
                            const parsed = parser.parseOrderPage(retryHtml, id);
                            if (parsed.address && (parsed.confirmScheduleDate || parsed.arrivalTimestamp)) {
                                dbDirty = this.processOrderData(orderDb, id, parsed) || dbDirty;
                            }
                        } else {
                            const parsed = parser.parseOrderPage(html, id);
                            if (parsed.address && (parsed.confirmScheduleDate || parsed.arrivalTimestamp)) {
                                dbDirty = this.processOrderData(orderDb, id, parsed) || dbDirty;
                            } else if (!parsed.address) {
                                orderDb[id]._status = 'failed';
                                dbDirty = true;
                            }
                        }
                        
                        await new Promise(r => setTimeout(r, DELAY_BETWEEN_DOWNLOADS_MS)); 
                    } catch (e: any) {
                        if (e.message === 'REQ_LIMIT') { 
                            this.warn('[Download] Hard limit reached');
                            incomplete = true; 
                            break; 
                        }
                        if (e.message.includes('Session expired')) {
                            throw e;
                        }
                        console.warn(`Failed to download order ${id}:`, e);
                    }
                }
                
                // Save progress
                if (dbDirty) {
                    await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
                    dbDirty = false;
                }
            }

            if (incomplete) {
                this.log(`[Download] Batching with ${this.fetcher.getRequestCount()} requests used`);
                return { orders: Object.values(orderDb), incomplete: true };
            }

            // STAGE 3: CREATE TRIPS
            // Refresh session before trip creation
            const sortedDates = Object.keys(this.groupOrdersByDate(orderDb)).sort();
            if (sortedDates.length > 0) {
                this.log('[Trips] Starting trip creation...');
                
                // Check soft limit before trips
                if (this.fetcher.shouldBatch()) {
                    this.log(`[Trips] Soft limit reached before trip creation, batching`);
                    return { orders: Object.values(orderDb), incomplete: true };
                }
                
                try {
                    cookie = await this.refreshSessionIfNeeded(userId);
                } catch (e: any) {
                    this.error('[Trips] Session refresh failed', e);
                    throw e;
                }
            }
            
            this.log(`[Trips] Building routes for ${sortedDates.length} dates...`);
            
            const ordersByDate = this.groupOrdersByDate(orderDb);
            const tripService = makeTripService(this.tripKV, this.trashKV, undefined, this.tripIndexDO);

            for (const date of sortedDates) {
                 // Check soft limit before each trip
                 if (this.fetcher.shouldBatch()) { 
                     this.log(`[Trips] Soft limit reached, ${sortedDates.length - sortedDates.indexOf(date)} trips remaining`);
                     incomplete = true; 
                     break; 
                 }

                const tripId = `hns_${userId}_${date}`;
                const existingTrip = await tripService.get(userId, tripId);
                
                // [!code ++] MODIFIED CONFLICT LOGIC
                if (existingTrip) {
                    const lastSys = new Date(existingTrip.updatedAt || existingTrip.createdAt).getTime();
                    const lastUser = existingTrip.lastModified ? new Date(existingTrip.lastModified).getTime() : 0;
                    
                    // Check if modified by user
                    if (lastUser > lastSys + USER_MODIFICATION_BUFFER_MS) {
                        
                        // 1. If explicit force requested, allow it
                        if (forceDates.includes(date)) {
                            this.log(`  ${date}: Overwriting user modifications (Force Sync)`);
                        } 
                        // 2. If recent (last 7 days), flag as conflict
                        else if (this.isWithinDays(date, 7)) {
                            this.log(`  ${date}: Conflict detected (User Modified). Pending confirmation.`);
                            conflicts.push(date);
                            continue; // Skip processing this date for now
                        } 
                        // 3. Old history - skip silently
                        else {
                            this.log(`  ${date}: Skipped (user modified, older than 7 days)`);
                            continue;
                        }
                    }
                }

                const created = await this.createTripForDate(
                    userId, date, ordersByDate[date], settingsId,
                    installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, 
                    wifiExtenderPay, voipPay, driveTimeBonus, 
                    tripService
                );
                
                // If trip creation failed due to limits, stop and batch
                if (!created) {
                    this.log(`[Trips] Trip creation failed for ${date}, will retry in next batch`);
                    incomplete = true;
                    break;
                }
            }

            if (incomplete) {
                this.log(`[Trips] Batching with ${this.fetcher.getRequestCount()} requests used`);
            }

            return { orders: Object.values(orderDb), incomplete, conflicts }; // [!code ++] Return conflicts
            
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

    // [!code ++] Helper for date check
    private isWithinDays(dateStr: string, days: number): boolean {
        const d = parseDateOnly(dateStr);
        if (!d) return false;
        const diff = Date.now() - d.getTime();
        return diff >= 0 && diff < (days * 24 * 60 * 60 * 1000);
    }

    // ... (rest of methods: groupOrdersByDate, processOrderData, scanUrl, createTripForDate) ...
    // Note: ensure createTripForDate has all the parameters passed correctly in previous files
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

    private processOrderData(orderDb: Record<string, OrderData>, id: string, parsed: OrderData): boolean {
        const existingOrder = orderDb[id];
        
        // Determine sync status
        const { syncStatus, needsResync } = determineOrderSyncStatus(parsed);
        
        // Check for incomplete→complete transition
        const wasIncompleteNowComplete = checkIncompleteToComplete(existingOrder, parsed);
        
        // Check if this was a resync that's now complete
        const wasResync = existingOrder?.needsResync === true;
        const nowComplete = syncStatus === 'complete';
        
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
        
        // Log if this was a successful resync
        if (wasResync && nowComplete) {
            this.log(`  ${id} [RESYNC SUCCESS] Timestamps updated`);
        } else if (wasResync && !nowComplete) {
            this.log(`  ${id} [RESYNC] Still incomplete/future`);
        }
        
        orderDb[id] = updatedOrder;
        
        const ts = parsed.arrivalTimestamp ? `Arr:${formatTimestamp(parsed.arrivalTimestamp)}` : '';
        const pole = parsed.hasPoleMount ? '+POLE' : '';
        const wifi = parsed.hasWifiExtender ? '+WIFI' : ''; 
        const voip = parsed.hasVoip ? '+VOIP' : ''; 
        const status = syncStatus === 'future' ? '[FUTURE]' : syncStatus === 'incomplete' ? '[INCOMPLETE]' : '';
        this.log(`  ${id} ${ts} ${pole} ${wifi} ${voip} ${status}`.trim());
        
        return true; // Data was modified
    }

    private async scanUrl(url: string, cookie: string, cb: (id: string) => void) {
        let current = url;
        let page = 0;
        while(current && page < 5) {
            // Check soft limit before each page
            if (this.fetcher.shouldBatch()) {
                break;
            }
            
            try {
                const res = await this.fetcher.safeFetch(current, { headers: { 'Cookie': cookie } });
                const html = await res.text();
                parser.extractIds(html).forEach(cb);
                current = parser.extractNextLink(html, current) || '';
                page++;
            } catch(e: any) { 
                if (e.message === 'REQ_LIMIT') break;
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
        wifiExtenderPay: number, 
        voipPay: number,
        driveTimeBonus: number,
        tripService: any
    ): Promise<boolean> {
        // ... (existing logic from previous steps) ...
        // Re-pasted here for completeness since user asked for "completed updated code"
        
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
            // DATE MISMATCH LOGIC
            let effectiveArrival = o.arrivalTimestamp;
            let effectiveDepartureComplete = o.departureCompleteTimestamp;
            let effectiveDepartureIncomplete = o.departureIncompleteTimestamp;

            if (effectiveDepartureIncomplete) {
                const incompleteDate = extractDateFromTs(effectiveDepartureIncomplete);
                if (incompleteDate && incompleteDate !== date) {
                    effectiveArrival = undefined;
                    effectiveDepartureComplete = undefined;
                    effectiveDepartureIncomplete = undefined;
                }
            }

            const calcOrder = {
                ...o,
                arrivalTimestamp: effectiveArrival,
                departureCompleteTimestamp: effectiveDepartureComplete,
                departureIncompleteTimestamp: effectiveDepartureIncomplete
            };

            let sortTime = calcOrder.arrivalTimestamp || 0;
            if (!sortTime) {
                let dateObj = parseDateOnly(o.confirmScheduleDate) || parseDateOnly(date);
                if (dateObj) sortTime = dateObj.getTime() + (parseTime(o.beginTime) * 60000);
            }

            const isPaid = !!calcOrder.departureCompleteTimestamp || !calcOrder.departureIncompleteTimestamp;

            let actualDuration: number;
            const endTs = calcOrder.departureIncompleteTimestamp || calcOrder.departureCompleteTimestamp;

            if (calcOrder.arrivalTimestamp && endTs) {
                const dur = Math.round((endTs - calcOrder.arrivalTimestamp) / 60000);
                if (dur > MIN_JOB_DURATION_MINS && dur < MAX_JOB_DURATION_MINS) {
                    actualDuration = dur;
                } else {
                    actualDuration = (o.type === 'Install' || o.type === 'Re-Install') ? 90 : 60;
                }
            } else {
                actualDuration = (o.type === 'Install' || o.type === 'Re-Install') ? 90 : 60;
            }

            return { ...o, _sortTime: sortTime, _isPaid: isPaid, _actualDuration: actualDuration };
        });

        ordersWithMeta.sort((a, b) => a._sortTime - b._sortTime);

        const hasPaymentUpdates = ordersWithMeta.some(o => 
            o.lastPaymentUpdate && 
            (Date.now() - o.lastPaymentUpdate) < 60000 
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
                if (this.fetcher.shouldBatch()) {
                    this.warn(`[Trip ${date}] Soft limit reached before commute calculation`);
                    return false;
                }
                
                try {
                    const leg = await this.router.getRouteInfo(startAddr, eAddr);
                    if (leg && leg.duration && isFinite(leg.duration)) {
                        commuteMins = Math.round(leg.duration / 60);
                    }
                } catch(e: any) {
                    if (e.message === 'REQ_LIMIT') {
                        this.warn(`[Trip ${date}] Hard limit reached during commute calculation`);
                        return false;
                    }
                    console.warn('Failed to get route info:', e);
                }
            }
            
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
        
        if (isNaN(startMins) || !isFinite(startMins) || startMins < 0 || startMins > 1440) {
            startMins = 9 * 60; 
        }

        const points: string[] = [startAddr];
        for (const o of ordersWithMeta) {
            const addr = buildAddress(o);
            if (addr) points.push(addr);
        }
        if (endAddr && endAddr.trim()) {
            points.push(endAddr);
        }

        let totalMins = 0, totalMeters = 0;
        
        for (let i = 0; i < points.length - 1; i++) {
            if (this.fetcher.shouldBatch()) {
                this.warn(`[Trip ${date}] Soft limit reached during route calculation, will retry in next batch`);
                return false; 
            }
            
            if (points[i] !== points[i+1]) {
                try {
                    const leg = await this.router.getRouteInfo(points[i], points[i+1]);
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
                } catch (e: any) {
                    if (e.message === 'REQ_LIMIT') {
                        this.warn(`[Trip ${date}] Hard limit reached during route calculation`);
                        return false; 
                    }
                    console.warn('Failed to get route leg:', e);
                }
            }
        }
        
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
        
        if (isNaN(jobMins) || !isFinite(jobMins) || jobMins < 0) {
            this.warn(`[Trip ${date}] Invalid jobMins: ${jobMins}`);
            return false;
        }
        
        const totalWorkMins = totalMins + jobMins;
        
        if (isNaN(totalWorkMins) || !isFinite(totalWorkMins) || totalWorkMins < 0) {
            this.warn(`[Trip ${date}] Invalid totalWorkMins calculated: ${totalWorkMins}`);
            return false;
        }
        
        const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
        const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

        let totalEarnings = 0; 
        let totalSuppliesCost = 0;
        const suppliesMap = new Map<string, number>();

        const applyDriveBonus = totalMins > 330;

        const stops: TripStop[] = ordersWithMeta.map((o: OrderWithMeta, i: number): TripStop => {
            let basePay = 0;
            let notes = `HNS #${o.id} (${o.type})`;
            let supplyItems: { type: string, cost: number }[] = [];
            
            if (!o._isPaid) {
                notes += ` [INCOMPLETE: $0]`;
            } else {
                if (o.hasPoleMount) {
                    basePay = installPay + poleCharge;
                    notes += ` [POLE: $${poleCharge}]`;
                    if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
                    if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
                } else {
                    if (o.type === 'Install' || o.type === 'Re-Install') basePay = installPay;
                    else if (o.type === 'Upgrade') basePay = upgradePay;
                    else basePay = repairPay;
                }

                if (o.hasWifiExtender) {
                    basePay += wifiExtenderPay;
                    notes += ` [WIFI: $${wifiExtenderPay}]`;
                }

                if (o.hasVoip) {
                    basePay += voipPay;
                    notes += ` [VOIP: $${voipPay}]`;
                }

                if (applyDriveBonus && driveTimeBonus > 0) {
                    basePay += driveTimeBonus;
                    notes += ` [DRIVE BONUS: $${driveTimeBonus}]`;
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