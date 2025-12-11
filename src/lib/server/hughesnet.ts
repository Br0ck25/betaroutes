// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { makeTripService } from './tripService';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';
const BASE_URL = 'https://dwayinstalls.hns.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const APP_DOMAIN = 'https://gorouteyourself.com/';

// SAFETY LIMITS
const MAX_REQUESTS_PER_BATCH = 35; 

export class HughesNetService {
  public logs: string[] = [];
  private requestCount = 0; 

  constructor(
    private kv: KVNamespace, 
    private encryptionKey: string,
    private tripKV: KVNamespace,
    private trashKV: KVNamespace,
    private settingsKV: KVNamespace,
    private googleApiKey: string | undefined
  ) {}

  // --- LOGGING ---
  private log(msg: string) { console.log(msg); this.logs.push(msg); }
  private warn(msg: string) { console.warn(msg); this.logs.push(`⚠️ ${msg}`); }
  private error(msg: string, e?: any) { console.error(msg, e); this.logs.push(`❌ ${msg} ${e ? '(' + e + ')' : ''}`); }

  private async safeFetch(url: string, options?: RequestInit) {
      if (this.requestCount >= MAX_REQUESTS_PER_BATCH) throw new Error('REQ_LIMIT');
      this.requestCount++;
      return fetch(url, options);
  }

  // --- AUTH ---
  async connect(userId: string, username: string, password: string) {
    this.log(`[HNS] Connecting user ${userId}...`);
    
    // 1. Attempt Login
    const cookie = await this.loginAndStoreSession(userId, username, password);
    if (!cookie) {
        this.error(`[HNS] Login failed: Invalid credentials or server rejected login.`);
        return false;
    }

    // 2. Encrypt & Store Creds SECURELY
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    // 3. Verify Session
    try {
        const verifyRes = await this.safeFetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT } });
        const verifyHtml = await verifyRes.text();
        
        if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) {
             this.error(`[HNS] Verification failed. Cookie was rejected.`);
             return false;
        }
        
        this.log(`[HNS] Connection verified successfully.`);
        return true;
    } catch(e) { 
        this.error(`[HNS] Verification error`, e);
        return false; 
    }
  }

  async disconnect(userId: string) {
      this.log(`[HNS] Disconnecting user ${userId}...`);
      await this.kv.delete(`hns:session:${userId}`);
      await this.kv.delete(`hns:cred:${userId}`);
      await this.kv.delete(`hns:db:${userId}`); 
      return true;
  }

  // --- SMART SYNC ---
  async sync(userId: string, settingsId?: string, installPay: number = 0, repairPay: number = 0, skipScan: boolean = false) {
    this.requestCount = 0;
    
    // 1. Authenticate
    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login. Please reconnect.');

    // 2. Load Existing DB
    let orderDb: Record<string, any> = {};
    const dbRaw = await this.kv.get(`hns:db:${userId}`);
    if (dbRaw) orderDb = JSON.parse(dbRaw);
    
    let foundIds = new Set<string>(Object.keys(orderDb));
    let dbDirty = false;
    let incomplete = false;

    // STAGE 1: HARVESTING 
    if (!skipScan) {
        try {
            const res = await this.safeFetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
            const html = await res.text();
            
            if (html.includes('name="Password"')) throw new Error('Session expired.');
            
            this.extractIds(html).forEach(id => foundIds.add(id));

            if (this.requestCount < 10) {
                const links = this.extractMenuLinks(html);
                const priorityLinks = links.filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));
                this.log(`[Stage 1] Scanning ${priorityLinks.length} pages...`);
                
                for (const link of priorityLinks) {
                    if (this.requestCount > 15) break; 
                    await this.scanUrlForOrders(link.url, cookie, foundIds);
                    await new Promise(r => setTimeout(r, 150));
                }
            }
        } catch (e: any) {
            if (e.message !== 'REQ_LIMIT') this.error('[Stage 1] Scan error', e);
        }
    }

    // C. Identify Missing Data
    const allIds = Array.from(foundIds);
    const missingDataIds = allIds.filter(id => !orderDb[id]);
    
    if (missingDataIds.length > 0) {
        this.log(`[Stage 1] Found ${missingDataIds.length} new orders.`);
        let fetchedCount = 0;
        for (const id of missingDataIds) {
            if (this.requestCount >= MAX_REQUESTS_PER_BATCH) {
                incomplete = true;
                this.warn(`[Limit] Pausing download.`);
                break;
            }

            try {
                const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                const res = await this.safeFetch(orderUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
                const html = await res.text();
                const parsed = this.parseOrderPage(html, id);
                
                if (parsed.address) {
                    orderDb[id] = parsed;
                    dbDirty = true;
                    fetchedCount++;
                    this.log(`[Stage 1] Downloaded Order ${id}`);
                }
                await new Promise(r => setTimeout(r, 200)); 
            } catch (e: any) {
                if (e.message === 'REQ_LIMIT') { incomplete = true; break; }
            }
        }

        if (dbDirty) {
            await this.kv.put(`hns:db:${userId}`, JSON.stringify(orderDb));
            this.log(`[Stage 1] Saved ${fetchedCount} orders.`);
            return { orders: Object.values(orderDb), incomplete: true }; 
        }
    }

    // STAGE 2: PROCESSING 
    this.log(`[Stage 2] Processing Routes...`);
    
    const ordersByDate: Record<string, any[]> = {};
    for (const order of Object.values(orderDb)) {
        if (!order.confirmScheduleDate) continue;
        let isoDate = this.toIsoDate(order.confirmScheduleDate);
        if (isoDate) {
            if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
            ordersByDate[isoDate].push(order);
        }
    }

    const sortedDates = Object.keys(ordersByDate).sort();
    const tripService = makeTripService(this.tripKV, this.trashKV);
    const existingTrips = await tripService.list(userId);
    
    let tripsProcessed = 0;
    for (const date of sortedDates) {
        if (this.requestCount >= MAX_REQUESTS_PER_BATCH) {
            incomplete = true;
            this.warn(`[Limit] Pause routing at ${date}.`);
            break;
        }

        const tripId = `hns_${userId}_${date}`;
        const existingTrip = existingTrips.find(t => t.id === tripId);
        if (existingTrip && existingTrip.totalMiles > 0) continue; 

        this.log(`[Stage 2] Routing ${date}...`);
        const daysOrders = ordersByDate[date];
        const success = await this.createTripForDate(userId, date, daysOrders, settingsId, installPay, repairPay, tripService);
        
        if (!success) {
            if (this.requestCount >= MAX_REQUESTS_PER_BATCH) {
                incomplete = true;
                break;
            }
        } else {
            tripsProcessed++;
        }
    }

    return { orders: Object.values(orderDb), incomplete };
  }

  async getOrders(userId: string) {
    const dbRaw = await this.kv.get(`hns:db:${userId}`);
    return dbRaw ? JSON.parse(dbRaw) : {};
  }

  async clearAllTrips(userId: string) {
      this.log(`[HNS] Clearing HNS trips...`);
      const tripService = makeTripService(this.tripKV, this.trashKV);
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
      installPay: number, repairPay: number, tripService: any
  ): Promise<boolean> {
      
      let defaultStart = '', defaultEnd = '', mpg = 25, gas = 3.50;
      try {
          const sRaw = await this.settingsKV.get(settingsId || userId) || await this.settingsKV.get(userId);
          if (sRaw) {
              const d = JSON.parse(sRaw).settings || JSON.parse(sRaw);
              defaultStart = d.defaultStartAddress || '';
              defaultEnd = d.defaultEndAddress || defaultStart;
              if (d.defaultMPG) mpg = parseFloat(d.defaultMPG);
              if (d.defaultGasPrice) gas = parseFloat(d.defaultGasPrice);
          }
      } catch(e) {}

      orders.sort((a, b) => this.parseTime(a.beginTime) - this.parseTime(b.beginTime));
      const buildAddr = (o: any) => [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');

      let startAddr = defaultStart;
      let endAddr = defaultEnd;
      if (!startAddr && orders.length > 0) {
          startAddr = buildAddr(orders[0]); 
          endAddr = startAddr;
      }

      const points = [startAddr, ...orders.map((o:any) => buildAddr(o)), endAddr];
      let totalMins = 0;
      let totalMeters = 0;
      let firstLegMins = 0;

      for (let i = 0; i < points.length - 1; i++) {
          const origin = points[i];
          const dest = points[i+1];
          if (origin === dest) continue;
          
          if (i > 0) await new Promise(r => setTimeout(r, 200));

          try {
              const leg = await this.getRouteInfo(origin, dest);
              if (leg) {
                  const m = Math.round(leg.duration / 60);
                  totalMins += m;
                  totalMeters += leg.distance;
                  if (i === 0) firstLegMins = m;
                  this.log(`[Maps] Leg ${i+1}: ${m} min`);
              }
          } catch (e: any) {
              if (e.message === 'REQ_LIMIT') return false; 
              this.error(`[Maps] Error`, e);
          }
      }

      const miles = Number((totalMeters * 0.000621371).toFixed(1));
      
      let minMins = 9 * 60; 
      if (orders.length > 0) {
          const t = this.parseTime(orders[0].beginTime);
          if (t < 24*60) minMins = t;
      }
      const startMins = minMins - firstLegMins;
      
      let jobMins = 0;
      orders.forEach((o:any) => jobMins += (o.jobDuration || 60));
      
      const totalWorkMins = totalMins + jobMins;
      const hoursWorked = Number((totalWorkMins / 60).toFixed(2));
      const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;
      const calcPay = (type: string) => (type === 'Install' ? installPay : repairPay);

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
          endAddress: endAddr,
          totalMiles: miles,
          mpg, gasPrice: gas,
          fuelCost: Number(fuelCost.toFixed(2)),
          stops: orders.map((o:any, i:number) => ({
              id: crypto.randomUUID(),
              address: buildAddr(o),
              order: i,
              notes: `HNS Order: ${o.id} (${o.type})`,
              earnings: calcPay(o.type),
              appointmentTime: o.beginTime,
              type: o.type,
              duration: o.jobDuration
          })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'synced'
      };

      await tripService.put(trip as any);
      this.log(`[Stage 2] Saved Trip ${date}`);
      return true;
  }

  // --- PRIVATE UTILS ---
  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey) return null;
      try {
          const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
          const res = await this.safeFetch(url, { headers: { 'Referer': APP_DOMAIN, 'User-Agent': 'BetaRoutes/1.0' } });
          const data = await res.json();
          if (data.routes?.[0]?.legs?.[0]) return { distance: data.routes[0].legs[0].distance.value, duration: data.routes[0].legs[0].duration.value };
      } catch (e: any) { 
          if (e.message === 'REQ_LIMIT') throw e; 
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
      if (!timeStr) return 9999;
      const m = timeStr.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
      if (!m) return 9999;
      let h = parseInt(m[1]);
      if (m[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (m[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + parseInt(m[2]);
  }

  private minutesToTime(minutes: number): string {
      if (minutes < 0) minutes += 1440; 
      let h = Math.floor(minutes / 60);
      const m = Math.floor(minutes % 60);
      if (h >= 24) h = h % 24;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private async scanUrlForOrders(url: string, cookie: string, idSet: Set<string>) {
      let current = url;
      let page = 0;
      while(current && page < 5) {
          try {
              const res = await this.safeFetch(current, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT } });
              const html = await res.text();
              this.extractIds(html).forEach(id => idSet.add(id));
              
              if (page === 0) { 
                  const frames = this.extractFrameUrls(html);
                  for (const f of frames) {
                      try {
                          const frameUrl = new URL(f, BASE_URL).href;
                          const fRes = await this.safeFetch(frameUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT } });
                          this.extractIds(await fRes.text()).forEach(id => idSet.add(id));
                      } catch(e){}
                  }
              }
              current = this.extractNextPageUrl(html, current) || '';
              page++;
          } catch(e) { break; }
      }
  }

  private extractNextPageUrl(html: string, currentUrl: string): string | null {
    const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:.*?(?:\bNext\b|&gt;|>).*?)<\/a>/i;
    const match = html.match(regex);
    if (match && match[1]) {
        let next = match[1].replace(/&amp;/g, '&');
        if (!next.startsWith('javascript')) {
             return new URL(next, currentUrl).href;
        }
    }
    return null;
  }

  private extractIds(html: string) {
    const ids = new Set<string>();
    const clean = html.replace(/&amp;/g, '&');
    let m;
    const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    while ((m = re1.exec(clean)) !== null) ids.add(m[1]);
    const re2 = /[?&]id=(\d{8})\b/gi;
    while ((m = re2.exec(clean)) !== null) ids.add(m[1]);
    return Array.from(ids);
  }

  private extractMenuLinks(html: string) {
    const links: { url: string, text: string }[] = [];
    const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url && (url.includes('.jsp') || url.includes('SoSearch')) && !url.startsWith('javascript')) {
             try {
                const absolute = new URL(url, BASE_URL).href;
                links.push({ url: absolute, text: m[2].replace(/<[^>]+>/g, '').trim() });
             } catch(e) {}
        }
    }
    return links;
  }

  private extractFrameUrls(html: string): string[] {
    const urls: string[] = [];
    const re = /<(?:frame|iframe)\s+[^>]*src=["']?([^"'>\s]+)["']?/gi;
    let m;
    while ((m = re.exec(html)) !== null) urls.push(m[1]);
    return urls;
  }

  private parseOrderPage(html: string, id: string) {
    const out: any = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '', type: 'Repair', jobDuration: 60 };
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    
    // Address
    const addr = html.match(/name=["']FLD_SO_Address1["'][^>]*value=["']([^"']*)["']/i) || html.match(/value=["']([^"']*)["'][^>]*name=["']FLD_SO_Address1["']/i);
    if (addr) out.address = addr[1].trim();
    if (!out.address) {
        const m = text.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (m) out.address = m[1].trim().split(/county:/i)[0].trim();
    }

    // City/State/Zip
    const city = html.match(/name=["']f_city["'][^>]*value=["']([^"']*)["']/i);
    if (city) out.city = city[1].trim();
    const state = html.match(/name=["']f_state["'][^>]*value=["']([^"']*)["']/i);
    if (state) out.state = state[1].trim();
    const zip = html.match(/name=["']f_zip["'][^>]*value=["']([^"']*)["']/i);
    if (zip) out.zip = zip[1].trim();

    // Date/Time
    const date = html.match(/name=["']f_sched_date["'][^>]*value=["']([^"']*)["']/i);
    if (date) out.confirmScheduleDate = date[1];
    else {
        const m = text.match(/Confirm Schedule Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (m) out.confirmScheduleDate = m[1];
    }
    const time = html.match(/name=["']f_begin_time["'][^>]*value=["']([^"']*)["']/i);
    if (time) out.beginTime = time[1];

    if (html.match(/Install/i) || text.includes('Install')) { out.type = 'Install'; out.jobDuration = 90; }
    
    return out;
  }

  // --- ENSURE SESSION COOKIE ---
  private async ensureSessionCookie(userId: string) {
    const session = await this.kv.get(`hns:session:${userId}`);
    if (session) return session;
    const enc = await this.kv.get(`hns:cred:${userId}`);
    if (!enc) return null;
    try {
        const dec = await this.decrypt(enc);
        const creds = JSON.parse(dec || '{}');
        if (creds.username && creds.password) {
             return this.loginAndStoreSession(userId, creds.username, creds.password);
        }
    } catch(e) {}
    return null;
  }

  // --- AUTH METHOD ---
  private async loginAndStoreSession(userId: string, u: string, p: string) {
    try {
        const params = new URLSearchParams();
        params.append('UserId', u);
        params.append('Password', p);
        
        const res = await fetch(LOGIN_URL, {
            method: 'POST',
            body: params,
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT 
            },
            redirect: 'manual' 
        });

        const cookieHeader = res.headers.get('set-cookie');
        const location = res.headers.get('Location') || '';

        if (cookieHeader) {
            // Check for failure redirect
            if (location && (location.includes('login.jsp') || location.includes('error'))) {
                this.warn(`[HNS] Server redirected back to login page.`);
                return null;
            }

            const simpleCookie = cookieHeader.split(';')[0]; 
            await this.kv.put(`hns:session:${userId}`, simpleCookie, { expirationTtl: 3600 });
            this.log(`[HNS] Logged in successfully.`);
            return simpleCookie;
        }
        
        this.warn(`[HNS] Login failed (no cookie returned).`);
    } catch(e) {
        this.error(`[HNS] Login error`, e);
    }
    return null;
  }

  // --- SECURE ENCRYPTION ---
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