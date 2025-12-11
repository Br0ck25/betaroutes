// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { makeTripService } from './tripService';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';
const BASE_URL = 'https://dwayinstalls.hns.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Domain for Google API Key Referer Header
const APP_DOMAIN = 'https://gorouteyourself.com/';

export class HughesNetService {
  constructor(
    private kv: KVNamespace, 
    private encryptionKey: string,
    private tripKV: KVNamespace,
    private trashKV: KVNamespace,
    private settingsKV: KVNamespace,
    private googleApiKey: string | undefined
  ) {}

  async connect(userId: string, username: string, password: string) {
    console.log(`[HNS] Connecting user ${userId}...`);
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    const cookie = await this.loginAndStoreSession(userId, username, password);
    if (!cookie) return false;

    const verifyRes = await fetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT } });
    const verifyHtml = await verifyRes.text();
    if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) return false;

    return true;
  }

  async sync(userId: string, settingsId?: string, installPay: number = 0, repairPay: number = 0) {
    console.log(`[HNS] Starting sync for ${userId} (Install Pay: $${installPay}, Repair Pay: $${repairPay})`);
    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login.');

    const res = await fetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
    const html = await res.text();
    if (html.includes('name="Password"')) throw new Error('Session expired. Please reconnect.');

    const uniqueIds = new Set<string>();
    this.extractIds(html).forEach(id => uniqueIds.add(id));

    if (uniqueIds.size === 0) {
        console.log('[HNS] Scanning menu links...');
        const links = this.extractMenuLinks(html);
        const priorityLinks = links.filter(l => l.url.includes('SoSearch') || l.url.includes('forms/'));

        for (const link of priorityLinks) {
            console.log(`[HNS] Scanning: ${link.text}`);
            await this.scanUrlForOrders(link.url, cookie, uniqueIds);
        }
    }

    const finalIds = Array.from(uniqueIds);
    console.log(`[HNS] Total unique orders found: ${finalIds.length}`);
    await this.kv.put(`hns:orders_index:${userId}`, JSON.stringify(finalIds));

    // FETCH DETAILS
    const orders: any[] = [];
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < finalIds.length; i += BATCH_SIZE) {
        const batch = finalIds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (id) => {
            try {
                const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
                const res = await fetch(orderUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
                const orderHtml = await res.text();
                
                const parsed = this.parseOrderPage(orderHtml, id);
                if (parsed.address) {
                    await this.kv.put(`hns:orders:${userId}:${id}`, JSON.stringify(parsed));
                    orders.push(parsed);
                } else {
                    // Log failed parse to help debugging
                    console.warn(`[HNS] Skipped Order ${id} due to missing address.`);
                }
            } catch (err) {
                console.error(`[HNS] Error syncing ${id}`, err);
            }
        }));
    }

    if (orders.length > 0) {
        await this.createTripsFromOrders(userId, orders, settingsId, installPay, repairPay);
    }

    return orders;
  }

  async getOrders(userId: string) {
    const indexRaw = await this.kv.get(`hns:orders_index:${userId}`);
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    const results: Record<string, any> = {};
    for (const id of index) {
      const v = await this.kv.get(`hns:orders:${userId}:${id}`);
      if (v) try { results[id] = JSON.parse(v); } catch(e) { results[id] = v; }
    }
    return results;
  }

  async clearAllTrips(userId: string) {
      console.log(`[HNS] Clearing HNS trips for ${userId}...`);
      const tripService = makeTripService(this.tripKV, this.trashKV);
      const allTrips = await tripService.list(userId);
      let count = 0;
      for (const trip of allTrips) {
          const isHns = 
            (trip.destinations && trip.destinations.some((d:any) => d.notes?.includes('HNS'))) ||
            (trip.stops && trip.stops.some((s:any) => s.notes?.includes('HNS'))) ||
            (trip.notes && trip.notes.includes('HNS'));

          if (isHns) {
              await tripService.delete(userId, trip.id);
              count++;
          }
      }
      return count;
  }

  // --- HELPERS and Private Methods ---
  
  private async scanUrlForOrders(url: string, cookie: string, idSet: Set<string>) {
    try {
        const res = await fetch(url, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT, 'Referer': HOME_URL }});
        const html = await res.text();
        this.extractIds(html).forEach(id => idSet.add(id));

        const frames = this.extractFrameUrls(html);
        for (const frameUrl of frames) {
            let absUrl = frameUrl;
            if (!frameUrl.startsWith('http')) {
                const currentDir = url.substring(0, url.lastIndexOf('/') + 1);
                absUrl = new URL(frameUrl, currentDir).href;
            }
            const fRes = await fetch(absUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
            const fHtml = await fRes.text();
            this.extractIds(fHtml).forEach(id => idSet.add(id));
        }
    } catch (e) { console.log(`[HNS] Failed to scan ${url}`); }
  }

  private extractMenuLinks(html: string) {
    const links: { url: string, text: string }[] = [];
    const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (url && !url.startsWith('javascript') && !url.startsWith('#') && (url.includes('.jsp') || url.includes('SoSearch'))) {
             if (!url.startsWith('http')) {
                if (url.startsWith('/')) url = `${BASE_URL}${url}`;
                else url = `${BASE_URL}/start/${url}`;
            }
            links.push({ url, text: m[2].replace(/<[^>]+>/g, '').trim() });
        }
    }
    return links;
  }

  private extractFrameUrls(html: string): string[] {
    const urls: string[] = [];
    const re = /<(?:frame|iframe)\s+[^>]*src=["']?([^"'>\s]+)["']?/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let url = m[1];
        if (!url.startsWith('http')) {
            url = url.replace(/^\.?\//, '');
            url = `${BASE_URL}/start/${url}`; 
        }
        urls.push(url);
    }
    return urls;
  }

  private extractIds(html: string) {
    const ids = new Set<string>();
    const cleanHtml = html.replace(/&amp;/g, '&');
    const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    let m;
    while ((m = re1.exec(cleanHtml)) !== null) ids.add(m[1]);
    if (ids.size === 0) {
        const re2 = /[?&]id=(\d{8})\b/gi;
        while ((m = re2.exec(cleanHtml)) !== null) ids.add(m[1]);
    }
    return Array.from(ids);
  }

  private parseOrderPage(html: string, id: string) {
    let text = html.replace(/<br\s*\/?>/gi, ' ').replace(/<\/td>/gi, '  ').replace(/<\/div>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const out: any = { 
        id, 
        address: '', 
        city: '', 
        state: '', 
        zip: '', 
        confirmScheduleDate: '', 
        beginTime: '',
        type: 'Repair', // Default
        jobDuration: 60 // Minutes
    };

    // --- PARSE ADDRESS ---
    const addrInput = html.match(/name=["']FLD_SO_Address1["'][^>]*value=["']([^"']*)["']/i);
    if (addrInput) {
        out.address = addrInput[1].trim();
    } else {
        // [DEBUG] CRITICAL LOGGING FOR CLOUDFLARE BLOCKING
        console.warn(`[HNS DEBUG] Failed to parse Address for Order ${id}.`);
        console.warn(`[HNS DEBUG] HTML Preview: ${html.substring(0, 500)}...`); 
    }

    const cityInput = html.match(/name=["']f_city["'][^>]*value=["']([^"']*)["']/i);
    if (cityInput) out.city = cityInput[1].trim();

    const stateInput = html.match(/name=["']f_state["'][^>]*value=["']([^"']*)["']/i);
    if (stateInput) out.state = stateInput[1].trim();

    const zipInput = html.match(/name=["']f_zip["'][^>]*value=["']([^"']*)["']/i);
    if (zipInput) out.zip = zipInput[1].trim();

    if (!out.address) {
        const addressMatch = text.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (addressMatch) out.address = addressMatch[1].trim().split(/county:/i)[0].trim();
    }
    if (!out.zip) {
        const zipMatch = html.match(/Zip(?:\/Postal)?:\s*(?:<[^>]+>)*\s*(\d{5})/i);
        if (zipMatch) out.zip = zipMatch[1];
    }

    // --- PARSE DATE & TIME ---
    const dateInput = html.match(/name=["']f_sched_date["'][^>]*value=["']([^"']*)["']/i);
    if (dateInput) out.confirmScheduleDate = dateInput[1];
    else {
        const m = text.match(/Confirm Schedule Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
        if (m) out.confirmScheduleDate = m[1];
    }

    const timeInput = html.match(/name=["']f_begin_time["'][^>]*value=["']([^"']*)["']/i);
    if (timeInput) out.beginTime = timeInput[1];
    else {
        const m = text.match(/Schd Est\. Begin Time:\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
        if (m) out.beginTime = m[1];
    }

    // --- PARSE JOB TYPE (INSTALL VS REPAIR) ---
    const typeMatch = html.match(/Service Order #:\d+.*?(Repair|Install)/i) || html.match(/class="PgTtl"[^>]*>.*?(Repair|Install)/si);
    
    if (typeMatch) {
        const foundType = typeMatch[1].toLowerCase();
        if (foundType === 'install') {
            out.type = 'Install';
            out.jobDuration = 90; // 1.5 Hours
        } else {
            out.type = 'Repair';
            out.jobDuration = 60; // 1.0 Hours
        }
    } else if (text.toLowerCase().includes('install')) {
         out.type = 'Install';
         out.jobDuration = 90;
    }

    return out;
  }

  private async createTripsFromOrders(
        userId: string, 
        orders: any[], 
        settingsId?: string, 
        installPay: number = 0, 
        repairPay: number = 0
    ) {
    const tripService = makeTripService(this.tripKV, this.trashKV);
    
    // FETCH SETTINGS
    let defaultStartAddress = '';
    let defaultEndAddress = '';
    let defaultMPG = 25; // Default fallback
    let defaultGasPrice = 3.50; // Default fallback
    const settingsKey = settingsId || userId;

    try {
        let settingsRaw = await this.settingsKV.get(settingsKey);
        if (!settingsRaw && settingsKey !== userId) {
             settingsRaw = await this.settingsKV.get(userId);
        }

        if (settingsRaw) {
            const data = JSON.parse(settingsRaw as string);
            const s = data.settings || data; 
            defaultStartAddress = s.defaultStartAddress || '';
            defaultEndAddress = s.defaultEndAddress || s.defaultStartAddress || '';
            
            // Extract MPG and Gas Price
            if (s.defaultMPG) defaultMPG = parseFloat(s.defaultMPG);
            if (s.defaultGasPrice) defaultGasPrice = parseFloat(s.defaultGasPrice);
            
            console.log(`[HNS] Settings Loaded for ${settingsKey}. Start="${defaultStartAddress}" MPG=${defaultMPG} Gas=${defaultGasPrice}`);
        } else {
            console.log(`[HNS] No Settings found for ${settingsKey}`);
        }
    } catch (e) { console.error('[HNS] Error reading settings:', e); }

    const ordersByDate: Record<string, any[]> = {};
    for (const order of orders) {
      if (!order.confirmScheduleDate) continue;
      let isoDate = order.confirmScheduleDate;
      if (order.confirmScheduleDate.includes('/')) {
          const parts = order.confirmScheduleDate.split('/');
          if (parts.length === 3) isoDate = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      }
      if (isoDate) {
          if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
          ordersByDate[isoDate].push(order);
      }
    }

    for (const [date, daysOrders] of Object.entries(ordersByDate)) {
      const existingTrips = await tripService.list(userId);
      if (existingTrips.some(t => t.date === date)) {
          console.log(`[HNS] Trip already exists for ${date}`);
          continue;
      }

      // 1. Sort orders chronologically
      daysOrders.sort((a, b) => this.parseTime(a.beginTime) - this.parseTime(b.beginTime));

      // 2. Determine Start Time of First Job
      let minMinutes = 9 * 60; // Default 9 AM
      let earliestOrder = daysOrders[0];
      const earliestTime = this.parseTime(earliestOrder.beginTime);
      if (earliestTime < 24 * 60) minMinutes = earliestTime;

      const buildAddr = (o: any) => {
          return [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');
      };

      let tripStart = defaultStartAddress;
      let tripEnd = defaultEndAddress || defaultStartAddress;

      if (!tripStart) {
          const firstJobAddr = buildAddr(earliestOrder);
          // If address parsing failed, this might be empty string
          if (firstJobAddr.length < 5) {
              console.warn(`[HNS] Warning: Start Address is empty (Job Address missing). Route calcs will fail.`);
          }
          console.log(`[HNS] Using Job Address as Start: ${firstJobAddr}`);
          tripStart = firstJobAddr;
          tripEnd = tripStart;
      }

      // --- MULTI-LEG CALCULATION (Google Only) ---
      let totalDriveMinutes = 0;
      let totalDistanceMeters = 0;
      let startToFirstJobMinutes = 0;

      // Construct path: Start -> Job1 -> Job2 ... -> JobN -> End
      const routePoints = [tripStart];
      daysOrders.forEach(o => routePoints.push(buildAddr(o)));
      routePoints.push(tripEnd);

      console.log(`[HNS] Calculating Route: ${routePoints.length - 1} legs for ${date}`);

      for (let i = 0; i < routePoints.length - 1; i++) {
          const origin = routePoints[i];
          const dest = routePoints[i+1];
          
          if (origin === dest) continue;
          
          // Skip API call if addresses are obviously bad
          if (!origin || !dest || origin.length < 3 || dest.length < 3) {
             console.warn(`[HNS] Skipping leg ${i+1} due to missing address: "${origin}" -> "${dest}"`);
             continue;
          }

          // Call Google Maps API
          const leg = await this.getRouteInfo(origin, dest);
          
          if (leg) {
              const legMinutes = Math.round(leg.duration / 60);
              totalDriveMinutes += legMinutes;
              totalDistanceMeters += leg.distance;
              
              if (i === 0) startToFirstJobMinutes = legMinutes;
              
              console.log(`[HNS] Leg ${i+1}: ${origin} -> ${dest} = ${legMinutes}m`);
          } else {
              console.warn(`[HNS] Failed leg ${i+1}: ${origin} -> ${dest}`);
          }
      }

      const totalDistanceMiles = Number((totalDistanceMeters * 0.000621371).toFixed(1));

      // Subtract ONE-WAY (Start->Job1) drive time from the first appointment time for START TIME
      const tripStartMinutes = minMinutes - startToFirstJobMinutes;
      const startTime = this.minutesToTime(tripStartMinutes);
      
      const h = Math.floor(totalDriveMinutes / 60);
      const m = totalDriveMinutes % 60;
      const totalTimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

      // --- NEW: Calculate Total Work Day Hours (Drive + Jobs) ---
      let totalJobMinutes = 0;
      daysOrders.forEach(o => {
          totalJobMinutes += (o.jobDuration || 60);
      });

      const totalWorkDayMinutes = totalDriveMinutes + totalJobMinutes;
      const hoursWorked = Number((totalWorkDayMinutes / 60).toFixed(2));

      // Calculate End Time
      const endTimeMinutes = tripStartMinutes + totalWorkDayMinutes;
      const endTime = this.minutesToTime(endTimeMinutes);

      // --- PAY LOGIC ---
      const calculatePay = (orderType: string) => {
          if (orderType === 'Install') return installPay;
          if (orderType === 'Repair') return repairPay;
          return 0;
      };

      const fuelCost = defaultMPG > 0 ? (totalDistanceMiles / defaultMPG) * defaultGasPrice : 0;

      const newTrip: any = { 
        id: crypto.randomUUID(),
        userId,
        date: date,
        startTime: startTime,
        endTime: endTime,
        estimatedTime: totalDriveMinutes, 
        totalTime: totalTimeStr,
        hoursWorked: hoursWorked, 
        startAddress: tripStart,
        endAddress: tripEnd,
        destinations: daysOrders.map(o => ({
          address: buildAddr(o),
          earnings: calculatePay(o.type), 
          notes: `HNS Order: ${o.id} (${o.type})`
        })),
        stops: daysOrders.map((o, i) => ({
            id: crypto.randomUUID(),
            address: buildAddr(o),
            order: i,
            notes: `HNS ID: ${o.id} - ${o.type}`,
            earnings: calculatePay(o.type),
            appointmentTime: o.beginTime,
            type: o.type,
            duration: o.jobDuration
        })),
        totalMiles: totalDistanceMiles,
        mpg: defaultMPG,
        gasPrice: defaultGasPrice,
        fuelCost: Number(fuelCost.toFixed(2)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'synced'
      };

      await tripService.put(newTrip);
      console.log(`[HNS] Created Trip for ${date} - Start: ${newTrip.startTime}, End: ${newTrip.endTime}, Hours: ${hoursWorked}, Miles: ${totalDistanceMiles}`);
    }
  }

  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey) return null;

      try {
          const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
          
          const res = await fetch(url, {
              headers: {
                  'Referer': APP_DOMAIN,
                  'User-Agent': 'BetaRoutes/1.0'
              }
          });
          
          const data = await res.json();
          
          if (data.routes?.[0]?.legs?.[0]) {
              return { 
                  distance: data.routes[0].legs[0].distance.value, 
                  duration: data.routes[0].legs[0].duration.value 
              };
          } 
          
          if (data.error_message) {
              console.error(`[HNS] Google Maps Error: ${data.error_message}`);
          }
      } catch (e) { 
          console.error('[HNS] Maps Network Error', e); 
      }
      return null;
  }

  private parseTime(timeStr: string): number {
      if (!timeStr) return 9999;
      const match = timeStr.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
      if (!match) return 9999;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const meridiem = match[3]?.toUpperCase();

      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return h * 60 + m;
  }

  private minutesToTime(minutes: number): string {
      if (minutes < 0) minutes += 1440; 
      let h = Math.floor(minutes / 60);
      const m = Math.floor(minutes % 60);
      if (h >= 24) h = h % 24;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
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
    const res = await fetch(LOGIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT }, body: form.toString(), redirect: 'manual' });
    let cookie = this.extractCookie(res);
    if (!cookie && res.status === 302) {
        const res2 = await fetch(res.headers.get('location') ? `${BASE_URL}${res.headers.get('location')}` : HOME_URL, { method: 'GET', headers: { 'Referer': LOGIN_URL, 'User-Agent': USER_AGENT }, redirect: 'manual' });
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