// src/lib/server/hughesnet/service.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { makeTripService } from '../tripService';
import { HughesNetFetcher } from './fetcher';
import { HughesNetAuth } from './auth';
import { HughesNetRouter } from './router';
import * as parser from './parser';
import type { OrderData } from './types';

// Helper Utils
function parseTime(timeStr: string): number {
    if (!timeStr) return 0; 
    const m = timeStr.match(/(\d{1,2})[:]?(\d{2})/);
    if (!m) return 0;
    let h = parseInt(m[1]);
    let min = parseInt(m[2]);
    if (timeStr.toLowerCase().includes('pm') && h < 12) h += 12;
    return h * 60 + min;
}

function minutesToTime(minutes: number): string {
    if (minutes < 0) minutes += 1440; 
    let h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    if (h >= 24) h = h % 24;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function toIsoDate(dateStr: string) {
    if (!dateStr) return null;
    if (dateStr.includes('/')) {
        const p = dateStr.split('/');
        if (p.length === 3) return `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
    }
    return dateStr;
}

export class HughesNetService {
    public logs: string[] = [];
    private fetcher: HughesNetFetcher;
    private auth: HughesNetAuth;
    private router: HughesNetRouter;

    constructor(
        private kv: KVNamespace, 
        encryptionKey: string,
        private logsKV: KVNamespace, // Kept for future logging use if needed
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

    // --- Public API ---

    async connect(userId: string, u: string, p: string) {
        this.log(`[HNS] Connecting user ${userId}...`);
        return this.auth.connect(userId, u, p);
    }

    async disconnect(userId: string) {
        this.log(`[HNS] Disconnecting user ${userId}...`);
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

    async sync(
        userId: string, 
        settingsId: string | undefined, 
        installPay: number, repairPay: number, upgradePay: number,     
        poleCost: number, concreteCost: number, poleCharge: number,
        skipScan: boolean
    ) {
        this.fetcher.resetCount();
        const cookie = await this.auth.ensureSessionCookie(userId);
        if (!cookie) throw new Error('Could not login. Please reconnect.');

        let orderDb: Record<string, OrderData> = {};
        const dbRaw = await this.kv.get(`hns:db:${userId}`);
        if (dbRaw) orderDb = JSON.parse(dbRaw);
        
        let dbDirty = false;
        let incomplete = false;
        const currentScanIds = new Set<string>();

        const registerFoundId = (id: string) => {
            currentScanIds.add(id);
            if (!orderDb[id]) {
                orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; 
                dbDirty = true;
            }
        };

        // STAGE 1: SCANNING
        if (!skipScan) {
            try {
                const res = await this.fetcher.safeFetch(parser.BASE_URL + '/start/Home.jsp', { headers: { 'Cookie': cookie }});
                const html = await res.text();
                if (html.includes('name="Password"')) throw new Error('Session expired.');
                
                parser.extractIds(html).forEach(registerFoundId);

                if (this.fetcher.getRequestCount() < 10) {
                    const links = parser.extractMenuLinks(html);
                    const priorityLinks = links.filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));
                    this.log(`[Stage 1] Scanning ${priorityLinks.length} pages...`);
                    
                    for (const link of priorityLinks) {
                        if (this.fetcher.getRequestCount() > 15) break; 
                        await this.scanUrl(link.url, cookie, registerFoundId);
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
            } catch (e: any) {
                if (e.message !== 'REQ_LIMIT') this.error('[Stage 1] Scan error', e);
            }

            if (!incomplete) {
                const previousCount = Object.keys(orderDb).length;
                for (const id of Object.keys(orderDb)) {
                    const isProtected = orderDb[id]?.departureIncomplete === true;
                    if (!currentScanIds.has(id) && !isProtected) {
                        delete orderDb[id];
                        dbDirty = true;
                    }
                }
                const dropped = previousCount - Object.keys(orderDb).length;
                if (dropped > 0) this.log(`[Stage 1] Pruned ${dropped} old orders.`);
            }
        }

        // STAGE 2: DOWNLOADING DETAILS
        const missingDataIds = Object.values(orderDb)
            .filter((o:any) => o._status === 'pending' || !o.address)
            .map((o:any) => o.id);
        
        if (missingDataIds.length > 0) {
            this.log(`[Stage 1] Found ${missingDataIds.length} orders needing details.`);
            for (const id of missingDataIds) {
                try {
                    const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                    const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                    const html = await res.text();
                    const parsed = parser.parseOrderPage(html, id);
                    
                    if (parsed.address) {
                        delete parsed._status; 
                        orderDb[id] = parsed;
                        dbDirty = true;
                        const poleMsg = parsed.hasPoleMount ? ' + POLE' : '';
                        this.log(`[Stage 1] Downloaded Order ${id} (${parsed.type}${poleMsg})`);
                    }
                    await new Promise(r => setTimeout(r, 200)); 
                } catch (e: any) {
                    if (e.message === 'REQ_LIMIT') { incomplete = true; break; }
                }
            }
            if (dbDirty) await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
        }

        // STAGE 3: PROCESSING TRIPS
        this.log(`[Stage 2] Processing Routes...`);
        const ordersByDate: Record<string, any[]> = {};
        for (const order of Object.values(orderDb)) {
            if (!order.confirmScheduleDate || !order.address) continue;
            let isoDate = toIsoDate(order.confirmScheduleDate);
            if (isoDate) {
                if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
                ordersByDate[isoDate].push(order);
            }
        }

        const sortedDates = Object.keys(ordersByDate).sort();
        const tripService = makeTripService(this.tripKV, this.trashKV, undefined, this.tripIndexDO);
        let tripsProcessed = 0;

        for (const date of sortedDates) {
             if (this.fetcher.getRequestCount() >= 30) {
                incomplete = true;
                this.warn(`[Limit] Buffer low. Stopping before ${date}.`);
                break;
            }

            // Check Lock
            const tripId = `hns_${userId}_${date}`;
            const existingTrip = await tripService.get(userId, tripId);
            if (existingTrip) {
                const lastSys = new Date(existingTrip.updatedAt || existingTrip.createdAt).getTime();
                const lastUser = existingTrip.lastModified ? new Date(existingTrip.lastModified).getTime() : 0;
                if (lastUser > lastSys + 120000) {
                    this.log(`[Stage 2] Skipping ${date} (Locked: User modified)`);
                    continue;
                }
            }

            this.log(`[Stage 2] Routing ${date}...`);
            const success = await this.createTripForDate(
                userId, date, ordersByDate[date], settingsId,
                installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, tripService
            );

            if (!success) {
                 if (this.fetcher.getRequestCount() >= 30) incomplete = true;
                 break;
            }
            tripsProcessed++;
        }

        return { orders: Object.values(orderDb), incomplete };
    }

    // --- Private Helpers ---

    private async scanUrl(url: string, cookie: string, cb: (id: string) => void) {
        let current = url;
        let page = 0;
        while(current && page < 5) {
            try {
                const res = await this.fetcher.safeFetch(current, { headers: { 'Cookie': cookie } });
                const html = await res.text();
                parser.extractIds(html).forEach(cb);

                if (page === 0) {
                    const frames = parser.extractFrameSources(html);
                    for (const f of frames) {
                        this.fetcher.safeFetch(f, { headers: { 'Cookie': cookie } })
                            .then(r => r.text())
                            .then(t => parser.extractIds(t).forEach(cb))
                            .catch(() => {});
                    }
                }

                current = parser.extractNextLink(html, current) || '';
                page++;
            } catch(e) { break; }
        }
    }

    private async createTripForDate(
        userId: string, date: string, orders: any[], settingsId: string | undefined, 
        installPay: number, repairPay: number, upgradePay: number,
        poleCost: number, concreteCost: number, poleCharge: number,
        tripService: any
    ): Promise<boolean> {
        let defaultStart = '', defaultEnd = '', mpg = 25, gas = 3.50;
        try {
            const sRaw = await this.settingsKV.get(settingsId || userId) || await this.settingsKV.get(userId);
            if (sRaw) {
                const d = JSON.parse(sRaw).settings || JSON.parse(sRaw);
                defaultStart = d.defaultStartAddress || '';
                defaultEnd = d.defaultEndAddress || '';
                if (d.defaultMPG) mpg = parseFloat(d.defaultMPG);
                if (d.defaultGasPrice) gas = parseFloat(d.defaultGasPrice);
            }
        } catch(e) {}

        orders.sort((a, b) => parseTime(a.beginTime) - parseTime(b.beginTime));
        const buildAddr = (o: any) => [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');

        let startAddr = defaultStart;
        let endAddr = defaultEnd;

        // Default Routing Logic
        if (!startAddr && orders.length > 0) {
            startAddr = buildAddr(orders[0]); 
            if (!endAddr) endAddr = startAddr;
        }
        if (startAddr && !endAddr) endAddr = startAddr;

        // Commute Calculation
        let startMins = 9 * 60;
        if (orders[0]) {
            const earliestMins = parseTime(orders[0].beginTime);
            let commuteMins = 0;
            const eAddr = buildAddr(orders[0]);
            if (startAddr && eAddr !== startAddr) {
                try {
                    const leg = await this.router.getRouteInfo(startAddr, eAddr);
                    if (leg) commuteMins = Math.round(leg.duration / 60);
                } catch(e) {}
            }
            startMins = earliestMins !== 0 ? (earliestMins - commuteMins) : (9 * 60);
        }

        const points = [startAddr, ...orders.map((o:any) => buildAddr(o))];
        if (endAddr) points.push(endAddr);

        let totalMins = 0, totalMeters = 0;
        const legPromises = [];
        
        for (let i = 0; i < points.length - 1; i++) {
            if (points[i] === points[i+1]) legPromises.push(Promise.resolve(null));
            else legPromises.push(this.router.getRouteInfo(points[i], points[i+1]));
        }

        try {
            const results = await Promise.all(legPromises);
            results.forEach((leg) => {
                if (leg) {
                    totalMins += Math.round(leg.duration / 60);
                    totalMeters += leg.distance;
                }
            });
        } catch (e: any) {
            if (e.message === 'REQ_LIMIT') {
                this.warn(`[Limit] Routing stopped at ${date}`);
                return false; 
            }
            this.error(`[Maps] Error`, e);
        }

        const miles = Number((totalMeters * 0.000621371).toFixed(1));
        let jobMins = 0;
        orders.forEach((o:any) => jobMins += (o.jobDuration || 60));
        const totalWorkMins = totalMins + jobMins;
        const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

        const suppliesMap = new Map<string, number>();
        let totalSuppliesCost = 0;

        const stops = orders.map((o:any, i:number) => {
            let basePay = 0;
            let notes = `HNS Order: ${o.id} (${o.type})`;
            let supplyItems: { type: string, cost: number }[] = [];
            
            if (o.departureIncomplete) {
                basePay = 0;
                notes += ` [DEPARTURE INCOMPLETE: $0]`;
            } else if (o.hasPoleMount) {
                basePay = installPay + poleCharge;
                notes += ` [POLE MOUNT +$${poleCharge}]`;
                if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
                if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
            } else {
                if (o.type === 'Install') basePay = installPay;
                else if (o.type === 'Upgrade') basePay = upgradePay;
                else basePay = repairPay;
            }

            if (supplyItems.length > 0) {
                const costs = supplyItems.map(s => `${s.type}: -$${s.cost}`).join(', ');
                notes += ` | Supplies: ${costs}`;
                supplyItems.forEach(item => {
                     const currentCost = suppliesMap.get(item.type) || 0;
                     suppliesMap.set(item.type, currentCost + item.cost);
                     totalSuppliesCost += item.cost;
                });
            }

            return {
                id: crypto.randomUUID(),
                address: buildAddr(o),
                order: i,
                notes,
                earnings: basePay,
                appointmentTime: o.beginTime,
                type: o.type,
                duration: o.jobDuration
            };
        });

        const tripSupplies = Array.from(suppliesMap.entries()).map(([type, cost]) => ({
            id: crypto.randomUUID(), type, cost
        }));

        const trip = {
            id: `hns_${userId}_${date}`, 
            userId, date,
            startTime: minutesToTime(startMins),
            endTime: minutesToTime(startMins + totalWorkMins),
            estimatedTime: totalMins,
            totalTime: `${Math.floor(totalMins/60)}h ${totalMins%60}m`,
            hoursWorked: Number((totalWorkMins / 60).toFixed(2)),
            startAddress: startAddr,
            endAddress: endAddr,
            totalMiles: miles,
            mpg, gasPrice: gas,
            fuelCost: Number(fuelCost.toFixed(2)),
            suppliesCost: totalSuppliesCost,
            supplyItems: tripSupplies,
            suppliesItems: tripSupplies,
            stops: stops,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced'
        };

        await tripService.put(trip as any);
        this.log(`[Stage 2] Saved Trip ${date} ($${trip.fuelCost} fuel, ${miles} mi)`);
        return true;
    }
}