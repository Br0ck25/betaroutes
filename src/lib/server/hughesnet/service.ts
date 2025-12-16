// src/lib/server/hughesnet/service.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { makeTripService } from '../tripService';
import { HughesNetFetcher } from './fetcher';
import { HughesNetAuth } from './auth';
import { HughesNetRouter } from './router';
import * as parser from './parser';
import type { OrderData } from './types';

// --- HELPERS ---

interface JobEvent {
    type: 'Arrival' | 'DepartureIncomplete' | 'DepartureComplete' | 'Unknown';
    ts: number;
    raw: string;
}

function analyzeJobHistory(rawText: string): JobEvent[] {
    if (!rawText) return [];
    const events: JobEvent[] = [];
    const str = String(rawText);

    // Split by labels to isolate the timestamps
    const segments = str.split(/(Arrival On Site|Departure Incomplete|Departure Complete)/i);

    for (let i = 1; i < segments.length; i += 2) {
        const label = segments[i]; 
        const timeChunk = segments[i - 1]; 

        // Regex allows optional space AND optional seconds
        // Matches "09/03/2025 10:47" or "09/03/2025 10:47:05"
        const timeMatch = timeChunk.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s*\d{1,2}:\d{2}(?::\d{2})?)/g);
        
        if (timeMatch && timeMatch.length > 0) {
            // Use the last timestamp found immediately before the label
            const timeStr = timeMatch[timeMatch.length - 1];
            const ts = parseDateTimeString(timeStr);

            let type: JobEvent['type'] = 'Unknown';
            if (label.toLowerCase().includes('arrival')) type = 'Arrival';
            else if (label.toLowerCase().includes('incomplete')) type = 'DepartureIncomplete';
            else if (label.toLowerCase().includes('complete')) type = 'DepartureComplete';

            if (ts > 0) {
                events.push({ type, ts, raw: label });
            }
        }
    }
    
    return events.sort((a, b) => a.ts - b.ts);
}

// Fallback: Scan raw string for any valid date/time
function findEarliestTimestamp(rawText: string): number {
    if (!rawText) return 0;
    const str = String(rawText);
    const regex = /(\d{1,2}\/\d{1,2}\/\d{4}\s*\d{1,2}:\d{2}(?::\d{2})?)/g;
    let match;
    let minTs = Infinity;
    
    while ((match = regex.exec(str)) !== null) {
        const ts = parseDateTimeString(match[1]);
        if (ts > 0 && ts < minTs) minTs = ts;
    }
    return minTs === Infinity ? 0 : minTs;
}

function parseDateTimeString(dtStr: string): number {
    if (!dtStr) return 0;
    const str = String(dtStr).trim();
    if (/^\d{13}$/.test(str)) return parseInt(str);
    
    // Matches MM/DD/YYYY HH:MM (seconds optional)
    const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return 0;

    const month = parseInt(m[1]) - 1; 
    const day = parseInt(m[2]);
    const year = parseInt(m[3]);
    const hour = parseInt(m[4]);
    const min = parseInt(m[5]);
    const sec = m[6] ? parseInt(m[6]) : 0;

    return new Date(year, month, day, hour, min, sec).getTime();
}

function parseDateOnly(dateStr: string): Date | null {
    if (!dateStr) return null;
    const clean = dateStr.trim();
    const m = clean.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
        let y = m[3];
        if (y.length === 2) y = '20' + y;
        return new Date(parseInt(y), parseInt(m[1]) - 1, parseInt(m[2]));
    }
    return null;
}

function toIsoDate(dateStr: string) {
    if (!dateStr) return null;
    const d = parseDateOnly(dateStr);
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function extractDateFromTs(ts: string): string | null {
    if (!ts) return null;
    if (/^\d{13}$/.test(String(ts))) {
         const d = new Date(parseInt(String(ts)));
         return toIsoDate(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
    }
    const latestTs = parseDateTimeString(ts);
    if (latestTs > 0) {
         const d = new Date(latestTs);
         return toIsoDate(`${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`);
    }
    return null;
}

// SIMPLIFIED 24-HOUR PARSER
// No AM/PM logic. Just reads "13:00" as 13 * 60 + 0
function parseTime(timeStr: string): number {
    const t24 = extract24HourTime(timeStr);
    if (!t24) return 0;

    const [h, m] = t24.split(':').map(Number);
    return h * 60 + m;
}


function minutesToTime(minutes: number): string {
    if (minutes < 0) minutes += 1440;

    let h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);

    return to12Hour(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
}


// --- SIMPLE TIME EXTRACTION & CONVERSION ---

function extract24HourTime(raw: string): string | null {
    if (!raw) return null;

    // Matches HH:MM or HH:MM:SS
    const match = raw.match(/\b(\d{1,2}:\d{2})(?::\d{2})?\b/);
    return match ? match[1] : null;
}

function to12Hour(time24: string): string {
    const [hStr, m] = time24.split(':');
    let h = parseInt(hStr, 10);

    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;

    return `${h}:${m} ${suffix}`;
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

    // --- Public API ---

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

    async sync(
        userId: string, 
        settingsId: string | undefined, 
        installPay: number, repairPay: number, upgradePay: number,      
        poleCost: number, concreteCost: number, poleCharge: number,
        skipScan: boolean
    ) {
        this.fetcher.resetCount();
        this.log(`[Sync Config] Rates -> Install: $${installPay} | Repair: $${repairPay} | Upgrade: $${upgradePay} | Pole Charge: $${poleCharge}`);

        const cookie = await this.auth.ensureSessionCookie(userId);
        if (!cookie) throw new Error('Could not login. Please reconnect.');

        let orderDb: Record<string, OrderData> = {};
        const dbRaw = await this.kv.get(`hns:db:${userId}`);
        if (dbRaw) orderDb = JSON.parse(dbRaw);
        
        let dbDirty = false;
        let incomplete = false;
        
        // STAGE 1: SCANNING
        if (!skipScan) {
            try {
                const res = await this.fetcher.safeFetch(parser.BASE_URL + '/start/Home.jsp', { headers: { 'Cookie': cookie }});
                const html = await res.text();
                if (html.includes('name="Password"')) throw new Error('Session expired.');
                
                parser.extractIds(html).forEach(id => {
                    if (!orderDb[id]) { orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; dbDirty = true; }
                });

                if (this.fetcher.getRequestCount() < 10) {
                    const links = parser.extractMenuLinks(html);
                    const priorityLinks = links.filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));
                    this.log(`[Stage 1] Scanning ${priorityLinks.length} pages...`);
                    
                    for (const link of priorityLinks) {
                        if (this.fetcher.getRequestCount() > 15) break; 
                        await this.scanUrl(link.url, cookie, (id) => {
                             if (!orderDb[id]) { orderDb[id] = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: '', jobDuration: 0, _status: 'pending' }; dbDirty = true; }
                        });
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
            } catch (e: any) {
                if (e.message !== 'REQ_LIMIT') this.error('[Stage 1] Scan error', e);
            }
        }

        // STAGE 1.5: SMART NEIGHBOR DISCOVERY
        const knownIds = Object.keys(orderDb).map(id => parseInt(id)).filter(n => !isNaN(n)).sort((a,b) => a - b);
        if (knownIds.length > 0 && !skipScan) {
            const minId = knownIds[0];
            
            const tryFetchId = async (targetId: number) => {
                 if (orderDb[String(targetId)]) return true; 
                 if (this.fetcher.getRequestCount() >= 200) return false; 

                 try {
                    const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${targetId}`;
                    const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                    const html = await res.text();
                    const parsed = parser.parseOrderPage(html, String(targetId));
                    if (parsed.address) {
                        delete parsed._status;
                        orderDb[String(targetId)] = parsed;
                        dbDirty = true;
                        this.log(`[Discovery] Found HIDDEN Order ${targetId}`);
                        return true;
                    }
                 } catch(e) {}
                 return false;
            };

            this.log(`[Stage 1.5] Smart Discovery...`);

            // GAP FILLER
            for (let i = 0; i < knownIds.length - 1; i++) {
                if (this.fetcher.getRequestCount() >= 150) break;
                const current = knownIds[i];
                const next = knownIds[i+1];
                if (next - current > 1 && next - current < 50) {
                    for (let j = current + 1; j < next; j++) {
                        await tryFetchId(j);
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
            }

            // BACKWARD SCAN (100 items)
            let failures = 0;
            let current = minId - 1;
            let checks = 0;
            while(failures < 50 && checks < 100) { 
                 const found = await tryFetchId(current);
                 if (found) failures = 0; else failures++;
                 current--;
                 checks++;
                 await new Promise(r => setTimeout(r, 80));
            }
            this.log(`[Stage 1.5] Backward Scan: Checked ${checks} IDs`);
        }

        // STAGE 2: DOWNLOADING DETAILS
        const missingDataIds = Object.values(orderDb)
            .filter((o:any) => (o._status === 'pending' || !o.address) && o._status !== 'failed')
            .map((o:any) => o.id);
        
        if (missingDataIds.length > 0) {
            this.log(`[Stage 2] Downloading details for ${missingDataIds.length} orders...`);
            for (const id of missingDataIds) {
                if (this.fetcher.getRequestCount() >= 250) {
                    incomplete = true;
                    this.warn(`[Limit] Pause downloading. Resuming next batch...`);
                    break;
                }

                try {
                    const orderUrl = `${parser.BASE_URL}/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                    const res = await this.fetcher.safeFetch(orderUrl, { headers: { 'Cookie': cookie }});
                    const html = await res.text();
                    const parsed = parser.parseOrderPage(html, id);
                    
                    if (parsed.address && (parsed.confirmScheduleDate || parsed.actualArrivalTs)) {
                        delete parsed._status; 
                        orderDb[id] = parsed;
                        dbDirty = true;
                        const poleMsg = parsed.hasPoleMount ? ' + POLE' : '';
                        this.log(`[Stage 2] Downloaded ${id}`);
                    } else {
                        if (!parsed.address) {
                            orderDb[id]._status = 'failed';
                            dbDirty = true;
                        }
                    }
                    await new Promise(r => setTimeout(r, 200)); 
                } catch (e: any) {
                    if (e.message === 'REQ_LIMIT') { incomplete = true; break; }
                }
            }
            if (dbDirty) await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
        }

        if (incomplete) {
            return { orders: Object.values(orderDb), incomplete: true };
        }

        // STAGE 3: PROCESSING TRIPS
        this.log(`[Stage 3] Processing Routes...`);
        
        const ordersByDate: Record<string, any[]> = {};
        for (const order of Object.values(orderDb)) {
            if (!order.address) continue; 
            let isoDate = toIsoDate(order.confirmScheduleDate);
            if (!isoDate && order.actualArrivalTs) isoDate = extractDateFromTs(order.actualArrivalTs);
            if (isoDate) {
                if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
                ordersByDate[isoDate].push(order);
            }
        }

        const sortedDates = Object.keys(ordersByDate).sort();
        const tripService = makeTripService(this.tripKV, this.trashKV, undefined, this.tripIndexDO);
        let tripsProcessed = 0;

        for (const date of sortedDates) {
             if (this.fetcher.getRequestCount() >= 250) { incomplete = true; break; }

            const tripId = `hns_${userId}_${date}`;
            const existingTrip = await tripService.get(userId, tripId);
            
            if (existingTrip) {
                const lastSys = new Date(existingTrip.updatedAt || existingTrip.createdAt).getTime();
                const lastUser = existingTrip.lastModified ? new Date(existingTrip.lastModified).getTime() : 0;
                if (lastUser > lastSys + 120000) {
                    this.log(`[Stage 3] Skipping ${date} (Locked: User modified)`);
                    continue;
                }
            }

            this.log(`[Stage 3] Routing ${date}...`);
            await this.createTripForDate(
                userId, date, ordersByDate[date], settingsId,
                installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge, tripService
            );
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
        } catch(e) {}

        const ordersWithMeta = orders.map((o: any) => {
            const events = analyzeJobHistory(o.actualArrivalTs);
            const arrivalEvent = events.find(e => e.type === 'Arrival');
            const incEvent = events.find(e => e.type === 'DepartureIncomplete');
            const comEvent = events.find(e => e.type === 'DepartureComplete');

            let sortTime = 0;
            if (arrivalEvent) sortTime = arrivalEvent.ts;
            else {
                const fallbackTs = findEarliestTimestamp(o.actualArrivalTs);
                if (fallbackTs > 0) {
                    sortTime = fallbackTs;
                } else {
                    let dateObj = parseDateOnly(o.confirmScheduleDate);
                    if (!dateObj) dateObj = parseDateOnly(date);
                    if (dateObj) sortTime = dateObj.getTime() + (parseTime(o.beginTime) * 60000);
                }
            }

            let isPaid = !!comEvent; 
            if (!isPaid) {
                if (incEvent || o.departureIncomplete) isPaid = false;
                else isPaid = true; 
            }

            let endTimeTs = 0;
            if (incEvent) endTimeTs = incEvent.ts;
            else if (comEvent) endTimeTs = comEvent.ts;

            return { 
                ...o, 
                _sortTime: sortTime, 
                _isPaid: isPaid, 
                _arrivalTs: (arrivalEvent ? arrivalEvent.ts : findEarliestTimestamp(o.actualArrivalTs)), 
                _endTs: endTimeTs 
            };
        });

        ordersWithMeta.sort((a, b) => a._sortTime - b._sortTime);

        // Find anchor order for trip start
        let anchorOrder = ordersWithMeta.find(o => o._sortTime > 0);
        if (!anchorOrder && ordersWithMeta.length > 0) anchorOrder = ordersWithMeta[0];

        const buildAddr = (o: any) => [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');

        let startAddr = defaultStart;
        let endAddr = defaultEnd;

        if (startAddr && !endAddr) endAddr = startAddr;
        if (!startAddr && anchorOrder) {
            startAddr = buildAddr(anchorOrder); 
            if (!endAddr) endAddr = startAddr;
        }

        let startMins = 9 * 60; 
        let commuteMins = 0;

        if (anchorOrder) {
            const eAddr = buildAddr(anchorOrder);
            if (startAddr && eAddr !== startAddr) {
                try {
                    const leg = await this.router.getRouteInfo(startAddr, eAddr);
                    if (leg) commuteMins = Math.round(leg.duration / 60);
                } catch(e) {}
            }

// 1️⃣ Prefer actual arrival timestamp from HughesNet
let arrivalTime24: string | null = null;

// 1️⃣ Preferred: numeric arrival timestamp
if (anchorOrder._arrivalTs && anchorOrder._arrivalTs > 0) {
    const d = new Date(anchorOrder._arrivalTs);
    arrivalTime24 = `${d.getHours().toString().padStart(2, '0')}:${d
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
}

// 2️⃣ Fallback: raw HughesNet timestamp string
if (!arrivalTime24 && anchorOrder.actualArrivalTs) {
    arrivalTime24 = extract24HourTime(anchorOrder.actualArrivalTs);
}



if (arrivalTime24) {
    const [h, m] = arrivalTime24.split(':').map(Number);
    startMins = (h * 60 + m) - commuteMins;

    this.log(
        `[Time] Start derived from Job ${anchorOrder.id} Arrival: ${to12Hour(arrivalTime24)}`
    );
}
// 2️⃣ Fallback to scheduled begin time
else {
    const schedMins = parseTime(anchorOrder.beginTime);
    if (schedMins > 0) {
        startMins = schedMins - commuteMins;
        this.log(
            `[Time] Start derived from Job ${anchorOrder.id} Schedule: ${minutesToTime(startMins)}`
        );
    } else {
        this.warn(
            `[Time] Job ${anchorOrder.id} has no valid time. Defaulting to 9 AM.`
        );
    }
}
}

        const points = [startAddr, ...ordersWithMeta.map((o:any) => buildAddr(o))];
        if (endAddr) points.push(endAddr);

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
                if (leg) {
                    totalMins += Math.round(leg.duration / 60);
                    totalMeters += leg.distance;
                }
            });
        } catch (e: any) {
            if (e.message === 'REQ_LIMIT') return false; 
        }

        const miles = Number((totalMeters * 0.000621371).toFixed(1));
        
        let jobMins = 0;
        ordersWithMeta.forEach((o:any) => {
            let duration = o.jobDuration || 60;
            if (o._arrivalTs > 0 && o._endTs > 0) {
                const diffMs = o._endTs - o._arrivalTs;
                if (diffMs > 0) duration = Math.round(diffMs / 60000);
            }
            jobMins += duration;
        });

        const totalWorkMins = totalMins + jobMins;
        const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
        const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

        let totalEarnings = 0; 
        let totalSuppliesCost = 0;
        const suppliesMap = new Map<string, number>();

        const stops = ordersWithMeta.map((o:any, i:number) => {
            let basePay = 0;
            let notes = `HNS Order: ${o.id} (${o.type})`;
            let supplyItems: { type: string, cost: number }[] = [];
            
            if (!o._isPaid) {
                basePay = 0;
                notes += ` [DEPARTURE INCOMPLETE: $0]`;
            } else {
                if (o.hasPoleMount) {
                    basePay = installPay + poleCharge;
                    notes += ` [POLE MOUNT: $${installPay} + $${poleCharge}]`;
                    if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
                    if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
                } 
                else {
                    if (o.type === 'Install') basePay = installPay;
                    else if (o.type === 'Upgrade') basePay = upgradePay;
                    else basePay = repairPay;
                }
            }

            totalEarnings += basePay;

            if (supplyItems.length > 0) {
                const costs = supplyItems.map(s => `${s.type}: -$${s.cost}`).join(', ');
                notes += ` | Supplies: ${costs}`;
                supplyItems.forEach(item => {
                      const currentCost = suppliesMap.get(item.type) || 0;
                      suppliesMap.set(item.type, currentCost + item.cost);
                      totalSuppliesCost += item.cost;
                });
            }

            if (o._endTs > 0 && o._arrivalTs > 0) {
                 const dur = Math.round((o._endTs - o._arrivalTs)/60000);
                 notes += ` | Logged Time: ${dur}m`;
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

        const netProfit = totalEarnings - (fuelCost + totalSuppliesCost);

        const trip = {
            id: `hns_${userId}_${date}`, 
            userId, date,
            startTime: minutesToTime(startMins),
            endTime: minutesToTime(startMins + totalWorkMins),
            estimatedTime: totalMins,
            totalTime: `${Math.floor(totalMins/60)}h ${totalMins%60}m`,
            hoursWorked,
            startAddress: startAddr,
            endAddress: endAddr,
            totalMiles: miles,
            mpg, gasPrice: gas,
            fuelCost: Number(fuelCost.toFixed(2)),
            totalEarnings, 
            netProfit: Number(netProfit.toFixed(2)),
            suppliesCost: totalSuppliesCost,
            supplyItems: tripSupplies,
            suppliesItems: tripSupplies,
            stops: stops,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced'
        };

        await tripService.put(trip as any);
        stops.forEach(s => this.log(`   > Stop ${s.order+1}: ${s.address} [${s.type}] ($${s.earnings})`));
        this.log(`[Stage 3] Saved Trip ${date}`);
        
        return true;
    }
}