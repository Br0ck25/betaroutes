// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { makeTripService } from './tripService';
import * as cheerio from 'cheerio'; 
import { extractIds, extractMenuLinks, parseOrderPage } from './hughesnet-parser'; // [!code ++] Use new parser

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';
const BASE_URL = 'https://dwayinstalls.hns.com';

// User-Agent Rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

const APP_DOMAIN = 'https://gorouteyourself.com/';
const MAX_REQUESTS_PER_BATCH = 35; 

export class HughesNetService {
  public logs: string[] = [];
  private requestCount = 0; 
  private userAgent: string;

  constructor(
    private kv: KVNamespace, 
    private encryptionKey: string,
    private tripKV: KVNamespace,
    private trashKV: KVNamespace,
    private settingsKV: KVNamespace,
    private googleApiKey: string | undefined,
    private directionsKV: KVNamespace | undefined 
  ) {
      this.userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  // --- LOGGING ---
  private log(msg: string) { console.log(msg); this.logs.push(msg); }
  private warn(msg: string) { console.warn(msg); this.logs.push(`⚠️ ${msg}`); }
  private error(msg: string, e?: any) { 
      console.error(msg, e); 
      this.logs.push(`❌ ${msg}`); 
  }

  private async safeFetch(url: string, options?: RequestInit) {
      if (this.requestCount >= MAX_REQUESTS_PER_BATCH) throw new Error('REQ_LIMIT');
      this.requestCount++;
      return fetch(url, options);
  }

  // --- AUTH ---
  async connect(userId: string, username: string, password: string) {
    this.log(`[HNS] Connecting user ${userId}...`);
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    const cookie = await this.loginAndStoreSession(userId, username, password);
    if (!cookie) return false;

    try {
        const verifyRes = await this.safeFetch(HOME_URL, { 
            headers: { 'Cookie': cookie, 'User-Agent': this.userAgent }
        });
        const verifyHtml = await verifyRes.text();
        if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) return false;
        return true;
    } catch (e) { return false; }
  }

  async disconnect(userId: string) {
      this.log(`[HNS] Disconnecting user ${userId}...`);
      await this.kv.delete(`hns:session:${userId}`);
      await this.kv.delete(`hns:cred:${userId}`);
      await this.kv.delete(`hns:db:${userId}`);
      return true;
  }

  private async ensureSessionCookie(userId: string) {
    const session = await this.kv.get(`hns:session:${userId}`);
    if (session) return session;
    const enc = await this.kv.get(`hns:cred:${userId}`);
    if (!enc) return null;
    const credsJson = await this.decrypt(enc);
    if (!credsJson) return null;
    const creds = JSON.parse(credsJson);
    return this.loginAndStoreSession(userId, creds.username, creds.password);
  }

  private async loginAndStoreSession(userId: string, username: string, password: string) {
    const form = new URLSearchParams();
    form.append('User', username);
    form.append('Password', password);
    form.append('Submit', 'Log In');
    form.append('ScreenSize', 'MED');
    form.append('AuthSystem', 'HNS');
    
    const res = await this.safeFetch(LOGIN_URL, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.userAgent }, 
        body: form.toString(), 
        redirect: 'manual' 
    });
    
    let cookie = this.extractCookie(res);
    
    if (!cookie && res.status === 302) {
        const location = res.headers.get('location');
        const nextUrl = location ? (location.startsWith('http') ? location : `${BASE_URL}${location}`) : HOME_URL;
        const res2 = await this.safeFetch(nextUrl, { 
            method: 'GET', 
            headers: { 'Referer': LOGIN_URL, 'User-Agent': this.userAgent },
            redirect: 'manual' 
        });
        cookie = this.extractCookie(res2);
    }
    
    if (cookie) await this.kv.put(`hns:session:${userId}`, cookie, { expirationTtl: 60 * 60 * 24 * 2 });
    return cookie;
  }

  private extractCookie(res: Response) {
    const h = res.headers.get('set-cookie');
    if (!h) return null;
    return h.split(/,(?=[^;]+=)/g).map(p => p.split(';')[0].trim()).filter(Boolean).join('; ');
  }

  // --- CONFIG MANAGEMENT ---
  // [!code ++] Save user supply/pay preferences
  async saveConfig(userId: string, config: any) {
      await this.kv.put(`hns:config:${userId}`, JSON.stringify(config));
  }

  // [!code ++] Get user supply/pay preferences
  async getConfig(userId: string) {
      const raw = await this.kv.get(`hns:config:${userId}`);
      return raw ? JSON.parse(raw) : null;
  }

  // --- SMART SYNC ---
  async sync(
      userId: string, 
      settingsId: string | undefined, 
      installPay: number = 0, 
      repairPay: number = 0, 
      upgradePay: number = 0,     
      poleCost: number = 0,        
      concreteCost: number = 0,
      poleCharge: number = 0,
      skipScan: boolean = false
  ) {
    this.requestCount = 0;
    
    // [!code ++] Persist these values for next time
    await this.saveConfig(userId, { installPay, repairPay, upgradePay, poleCost, concreteCost, poleCharge });

    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login. Please reconnect.');

    let orderDb: Record<string, any> = {};
    const dbRaw = await this.kv.get(`hns:db:${userId}`);
    if (dbRaw) orderDb = JSON.parse(dbRaw);
    
    let dbDirty = false;
    let incomplete = false;
    const currentScanIds = new Set<string>();

    const registerFoundId = (id: string) => {
        currentScanIds.add(id);
        if (!orderDb[id]) {
            orderDb[id] = { id, _status: 'pending' }; 
            dbDirty = true;
        }
    };

    // STAGE 1: HARVESTING 
    if (!skipScan) {
        try {
            const res = await this.safeFetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': this.userAgent }});
            const html = await res.text();
            if (html.includes('name="Password"')) throw new Error('Session expired.');
            
            // [!code changed] Use imported parser
            extractIds(html).forEach(registerFoundId);

            if (this.requestCount < 10) {
                const links = extractMenuLinks(html, BASE_URL);
                const priorityLinks = links.filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));
                this.log(`[Stage 1] Scanning ${priorityLinks.length} pages...`);
                
                for (const link of priorityLinks) {
                    if (this.requestCount > 15) break; 
                    await this.scanUrlForOrders(link.url, cookie, registerFoundId);
                    await new Promise(r => setTimeout(r, 150));
                }
            }
        } catch (e: any) {
            if (e.message !== 'REQ_LIMIT') this.error('[Stage 1] Scan error', e);
        }

        // PRUNING
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

    const missingDataIds = Object.values(orderDb)
        .filter((o:any) => o._status === 'pending' || !o.address)
        .map((o:any) => o.id);
    
    if (missingDataIds.length > 0) {
        this.log(`[Stage 1] Found ${missingDataIds.length} orders needing details.`);
        
        for (const id of missingDataIds) {
            if (this.requestCount >= MAX_REQUESTS_PER_BATCH) {
                incomplete = true;
                this.warn(`[Limit] Pause downloading. Resuming next batch...`);
                break;
            }

            try {
                const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                const res = await this.safeFetch(orderUrl, { headers: { 'Cookie': cookie, 'User-Agent': this.userAgent }});
                const html = await res.text();
                
                // [!code changed] Use imported parser
                const parsed = parseOrderPage(html, id);
                
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

        if (dbDirty) {
            await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
        }
    }

    // STAGE 2: PROCESSING 
    this.log(`[Stage 2] Processing Routes...`);
    
    const ordersByDate: Record<string, any[]> = {};
    for (const order of Object.values(orderDb)) {
        if (!order.confirmScheduleDate || !order.address) continue;
        let isoDate = this.toIsoDate(order.confirmScheduleDate);
        if (isoDate) {
            if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
            ordersByDate[isoDate].push(order);
        }
    }

    const sortedDates = Object.keys(ordersByDate).sort();
    const tripService = makeTripService(this.tripKV, this.trashKV, undefined);
    
    let tripsProcessed = 0;
    for (const date of sortedDates) {
        if (this.requestCount >= (MAX_REQUESTS_PER_BATCH - 5)) {
            incomplete = true;
            this.warn(`[Limit] Buffer low. Stopping before ${date}.`);
            break;
        }

        const tripId = `hns_${userId}_${date}`;
        const existingTrip = await tripService.get(userId, tripId);
        
        if (existingTrip) {
            const lastSystemUpdate = new Date(existingTrip.updatedAt || existingTrip.createdAt).getTime();
            const lastUserEdit = existingTrip.lastModified ? new Date(existingTrip.lastModified).getTime() : 0;
            if (lastUserEdit > lastSystemUpdate + 120000) {
                this.log(`[Stage 2] Skipping ${date} (Locked: User manually modified)`);
                continue;
            }
        }

        this.log(`[Stage 2] Routing ${date}...`);
        const daysOrders = ordersByDate[date];
        const success = await this.createTripForDate(
            userId, date, daysOrders, settingsId, 
            installPay, repairPay, upgradePay, 
            poleCost, concreteCost, poleCharge, 
            tripService
        );
        
        if (!success) {
            if (this.requestCount >= MAX_REQUESTS_PER_BATCH) {
                incomplete = true;
                break;
            }
        } else {
            tripsProcessed++;
        }
    }

    if (tripsProcessed === 0 && !incomplete) {
        this.log('[Stage 2] All dates checked.');
    } else {
        this.log(`[Stage 2] Processed ${tripsProcessed} dates.`);
    }

    return { orders: Object.values(orderDb), incomplete };
  }

  async getOrders(userId: string) {
    const dbRaw = await this.kv.get(`hns:db:${userId}`);
    return dbRaw ? JSON.parse(dbRaw) : {};
  }

  async clearAllTrips(userId: string) {
      const tripService = makeTripService(this.tripKV, this.trashKV, undefined);
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

  // --- TRIP CALCULATION ---
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
              // [!code changed] Strict Rule: If no end address, use start address
              defaultEnd = d.defaultEndAddress || defaultStart; 
              if (d.defaultMPG) mpg = parseFloat(d.defaultMPG);
              if (d.defaultGasPrice) gas = parseFloat(d.defaultGasPrice);
          }
      } catch(e) {}

      orders.sort((a, b) => this.parseTime(a.beginTime) - this.parseTime(b.beginTime));
      
      const buildAddr = (o: any) => [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');

      let startAddr = defaultStart;
      let endAddr = defaultEnd;
      
      // [!code changed] Fallback to order address if NO default start is set
      if (!startAddr && orders.length > 0) {
          startAddr = buildAddr(orders[0]); 
          endAddr = startAddr;
      }
      
      // [!code changed] Ensure End matches Start if End is missing (redundant check for safety)
      if (!endAddr && startAddr) {
          endAddr = startAddr;
      }

      let earliestOrder: any = orders[0];
      let startMins = 9 * 60; 

      if (earliestOrder) {
          const earliestMins = this.parseTime(earliestOrder.beginTime);
          let commuteMins = 0;
          const eAddr = buildAddr(earliestOrder);
          
          if (startAddr && eAddr !== startAddr) {
              try {
                  const leg = await this.getRouteInfo(startAddr, eAddr);
                  if (leg) commuteMins = Math.round(leg.duration / 60);
              } catch(e) { }
          }
          startMins = earliestMins !== 0 ? (earliestMins - commuteMins) : (9 * 60);
      }

      // Parallel Route Calculation
      const points = [startAddr, ...orders.map((o:any) => buildAddr(o)), endAddr];
      let totalMins = 0;
      let totalMeters = 0;

      const legPromises = [];
      for (let i = 0; i < points.length - 1; i++) {
          const origin = points[i];
          const dest = points[i+1];
          if (origin === dest) {
              legPromises.push(Promise.resolve(null));
          } else {
              legPromises.push(this.getRouteInfo(origin, dest)); 
          }
      }

      try {
          const results = await Promise.all(legPromises);
          results.forEach((leg, index) => {
              if (leg) {
                  const m = Math.round(leg.duration / 60);
                  totalMins += m;
                  totalMeters += leg.distance;
              } else if (points[index] !== points[index+1]) {
                  this.warn(`[Maps] Failed leg ${index+1}: ${points[index]} -> ${points[index+1]}`);
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
      const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
      const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

      const calculateEarnings = (o: any) => {
          let basePay = 0;
          let notes = `HNS Order: ${o.id} (${o.type})`;
          let supplyItems: { type: string, cost: number }[] = [];
          
          if (o.departureIncomplete) {
              basePay = 0;
              notes += ` [DEPARTURE INCOMPLETE: $0]`;
          } 
          else if (o.hasPoleMount) {
              basePay = installPay + poleCharge;
              notes += ` [POLE MOUNT +$${poleCharge}]`;
              if (poleCost > 0) supplyItems.push({ type: 'Pole', cost: poleCost });
              if (concreteCost > 0) supplyItems.push({ type: 'Concrete', cost: concreteCost });
          } 
          else {
              if (o.type === 'Install') basePay = installPay;
              else if (o.type === 'Upgrade') basePay = upgradePay;
              else basePay = repairPay;
          }

          if (supplyItems.length > 0) {
              const costs = supplyItems.map(s => `${s.type}: -$${s.cost}`).join(', ');
              notes += ` | Supplies: ${costs}`;
          }

          return { amount: basePay, notes, supplyItems };
      };

      const suppliesMap = new Map<string, number>();
      let totalSuppliesCost = 0;

      const stops = orders.map((o:any, i:number) => {
          const fin = calculateEarnings(o);
          
          if (fin.supplyItems && fin.supplyItems.length > 0) {
              fin.supplyItems.forEach(item => {
                   const currentCost = suppliesMap.get(item.type) || 0;
                   suppliesMap.set(item.type, currentCost + item.cost);
                   totalSuppliesCost += item.cost;
              });
          }

          return {
              id: crypto.randomUUID(),
              address: buildAddr(o),
              order: i,
              notes: fin.notes,
              earnings: fin.amount,
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
          userId,
          date,
          startTime: this.minutesToTime(startMins),
          endTime: this.minutesToTime(startMins + totalWorkMins),
          estimatedTime: totalMins,
          totalTime: `${Math.floor(totalMins/60)}h ${totalMins%60}m`,
          hoursWorked,
          startAddress: startAddr,
          endAddress: endAddr, // [!code verified] uses start if defaultEnd was empty
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

  // --- UTILS ---
  // Parsing logic moved to hughesnet-parser.ts
  // Kept scanUrlForOrders here as it does fetching, but it calls extractIds
  private async scanUrlForOrders(url: string, cookie: string, callback: (id: string) => void) {
      let current = url;
      let page = 0;
      while(current && page < 5) {
          try {
              const res = await this.safeFetch(current, { headers: { 'Cookie': cookie, 'User-Agent': this.userAgent } });
              const html = await res.text();
              
              // [!code changed] Use imported parser
              extractIds(html).forEach(callback);
              
              const $ = cheerio.load(html);
              if (page === 0) { 
                  $('frame, iframe').each((_, el) => {
                      const src = $(el).attr('src');
                      if (src) {
                          try {
                              const frameUrl = new URL(src, BASE_URL).href;
                              this.safeFetch(frameUrl, { headers: { 'Cookie': cookie, 'User-Agent': this.userAgent } })
                                  .then(r => r.text())
                                  .then(t => extractIds(t).forEach(callback))
                                  .catch(() => {});
                          } catch(e){}
                      }
                  });
              }
              
              const nextLink = $('a').filter((_, el) => {
                  const t = $(el).text().toLowerCase();
                  return t.includes('next') || t.includes('>');
              }).first().attr('href');

              if (nextLink && !nextLink.startsWith('javascript')) {
                  current = new URL(nextLink, current).href;
              } else {
                  current = '';
              }
              page++;
          } catch(e) { break; }
      }
  }

  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey) return null;
      const key = `dir:${origin.toLowerCase().trim()}_to_${destination.toLowerCase().trim()}`;
      if (this.directionsKV) {
          const cached = await this.directionsKV.get(key);
          if (cached) return JSON.parse(cached);
      }
      try {
          const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
          const res = await this.safeFetch(url, { headers: { 'Referer': APP_DOMAIN, 'User-Agent': 'BetaRoutes/1.0' } });
          const data = await res.json();
          if (data.routes?.[0]?.legs?.[0]) {
              const result = { distance: data.routes[0].legs[0].distance.value, duration: data.routes[0].legs[0].duration.value };
              if (this.directionsKV) await this.directionsKV.put(key, JSON.stringify(result));
              return result;
          }
      } catch (e: any) { 
          if (e.message === 'REQ_LIMIT') throw e; 
          this.error('[Maps] API Error', e);
      }
      return null;
  }

  private toIsoDate(dateStr: string) {
      if (!dateStr) return null;
      if (dateStr.includes('/')) {
          const p = dateStr.split('/');
          if (p.length === 3) return `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
      }
      return dateStr;
  }

  private parseTime(timeStr: string): number {
      if (!timeStr) return 0; 
      const m = timeStr.match(/(\d{1,2})[:]?(\d{2})/);
      if (!m) return 0;
      let h = parseInt(m[1]);
      let min = parseInt(m[2]);
      return h * 60 + min;
  }

  private minutesToTime(minutes: number): string {
      if (minutes < 0) minutes += 1440; 
      let h = Math.floor(minutes / 60);
      const m = Math.floor(minutes % 60);
      if (h >= 24) h = h % 24;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private async encrypt(plain: string) {
    if (!this.encryptionKey) return plain;
    const keyRaw = Uint8Array.from(atob(this.encryptionKey), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
    const combined = new Uint8Array(iv.byteLength + enc.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(enc), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
  }

  private async decrypt(cipherB64: string) {
    if (!this.encryptionKey) return cipherB64;
    try {
        const combined = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const keyRaw = Uint8Array.from(atob(this.encryptionKey), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
        return new TextDecoder().decode(dec);
    } catch (e) { return null; }
  }
}