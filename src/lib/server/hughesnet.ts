// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { makeTripService } from './tripService';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';
const BASE_URL = 'https://dwayinstalls.hns.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class HughesNetService {
  constructor(
    private kv: KVNamespace, 
    private encryptionKey: string,
    private tripKV: KVNamespace,
    private settingsKV: KVNamespace,
    private googleApiKey: string
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

  async sync(userId: string) {
    console.log(`[HNS] Starting sync for ${userId}`);
    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login.');

    const res = await fetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
    const html = await res.text();
    if (html.includes('name="Password"')) throw new Error('Session expired.');

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
    console.log(`[HNS] Orders found: ${finalIds.length}`);
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
                }
            } catch (err) {
                console.error(`[HNS] Error syncing ${id}`, err);
            }
        }));
    }

    if (orders.length > 0) {
        await this.createTripsFromOrders(userId, orders);
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

  // --- HELPERS ---

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
    const re = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    return Array.from(ids);
  }

  private parseOrderPage(html: string, id: string) {
    // Aggressive normalization
    let text = html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/td>/gi, '  ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');

    const out: any = { id, address: '', city: '', state: '', zip: '', confirmScheduleDate: '', beginTime: '' };

    // 1. Try Inputs (Most Reliable)
    const addrInput = html.match(/name=["']FLD_SO_Address1["'][^>]*value=["']([^"']*)["']/i);
    if (addrInput) out.address = addrInput[1].trim();

    const cityInput = html.match(/name=["']f_city["'][^>]*value=["']([^"']*)["']/i);
    if (cityInput) out.city = cityInput[1].trim();

    const stateInput = html.match(/name=["']f_state["'][^>]*value=["']([^"']*)["']/i);
    if (stateInput) out.state = stateInput[1].trim();

    const zipInput = html.match(/name=["']f_zip["'][^>]*value=["']([^"']*)["']/i);
    if (zipInput) out.zip = zipInput[1].trim();

    // 2. Try Regex Text
    if (!out.address) {
        const m = text.match(/Address:\s*(.*?)\s+(?:City|County|State)/i);
        if (m) out.address = m[1].trim().split(/county:/i)[0].trim();
    }
    if (!out.city) {
        const m = text.match(/City:\s*(.*?)\s+(?:State|County|Zip)/i);
        if (m) out.city = m[1].trim();
    }
    if (!out.state) {
        const m = text.match(/State(?:\/Cnty)?:\s*(.*?)\s+(?:Zip|County|Phone)/i);
        if (m) out.state = m[1].trim().replace(/,$/, '');
    }
    if (!out.zip) {
        const m = text.match(/Zip(?:\/Postal)?:\s*(\d{5})/i);
        if (m) out.zip = m[1];
    }

    // 3. Fallback: If City is empty, use County or extract from address
    if (!out.city) {
        const countyMatch = text.match(/County:\s*(.*?)\s+(?:State|Zip)/i);
        if (countyMatch) out.city = countyMatch[1].trim();
    }

    // 4. Date/Time
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

    return out;
  }

  // --- TRIP CREATION ---
  private async createTripsFromOrders(userId: string, orders: any[]) {
    const tripService = makeTripService(this.tripKV, undefined);
    
    // --- LOAD SETTINGS (MOVED TO TOP) ---
    let defaultStartAddress = '';
    let defaultEndAddress = '';
    
    console.log(`[HNS DEBUG] Loading Settings for ${userId}...`);
    try {
        let settingsRaw = await this.settingsKV.get(`BETA_USER_SETTINGS_KV:${userId}`);
        if (!settingsRaw) settingsRaw = await this.settingsKV.get(userId);

        if (settingsRaw) {
            const settings = JSON.parse(settingsRaw as string);
            defaultStartAddress = settings.defaultStartAddress || '';
            defaultEndAddress = settings.defaultEndAddress || settings.defaultStartAddress || '';
            console.log(`[HNS DEBUG] Found Start Address: "${defaultStartAddress}"`);
        } else {
            console.log(`[HNS DEBUG] No Settings Found.`);
        }
    } catch (e) { console.error('[HNS] Settings Error', e); }

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
          console.log(`[HNS] Trip already exists for ${date} (Skipping)`);
          continue;
      }

      let minMinutes = 9 * 60; 
      let earliestOrder = daysOrders[0];

      for (const order of daysOrders) {
        const m = this.parseTime(order.beginTime);
        if (m < 24 * 60 && m < minMinutes) {
            minMinutes = m;
            earliestOrder = order;
        }
      }

      const buildAddr = (o: any) => {
          return [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');
      };

      const firstJobAddress = buildAddr(earliestOrder);
      
      // --- FALLBACK LOGIC ---
      // If start address is missing, use the first job's address so the trip is valid.
      let tripStart = defaultStartAddress;
      let tripEnd = defaultEndAddress;
      
      if (!tripStart) {
          tripStart = firstJobAddress; // Fallback
          tripEnd = firstJobAddress;   // Fallback
          console.log(`[HNS] Warning: Using Job Address as Start because Settings are empty.`);
      }

      let driveTimeMinutes = 0;
      let distanceMiles = 0;
      if (tripStart && firstJobAddress) {
         const route = await this.getRouteInfo(tripStart, firstJobAddress);
         if (route) {
             driveTimeMinutes = Math.round(route.duration / 60);
             distanceMiles = Number((route.distance * 0.000621371).toFixed(1));
         }
      }

      const tripStartMinutes = minMinutes - driveTimeMinutes;
      const startTime = this.minutesToTime(tripStartMinutes);

      const newTrip: any = { 
        id: crypto.randomUUID(),
        userId,
        date: date,
        startClock: startTime,
        endClock: "17:00",
        startAddress: tripStart,
        endAddress: tripEnd,
        destinations: daysOrders.map(o => ({
          address: buildAddr(o),
          earnings: 0,
          notes: `HNS Order: ${o.id}`
        })),
        stops: daysOrders.map((o, i) => ({
            id: crypto.randomUUID(),
            address: buildAddr(o),
            order: i,
            notes: `HNS ID: ${o.id}`,
            earnings: 0
        })),
        totalMileage: distanceMiles * 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'synced'
      };

      await tripService.put(newTrip);
      console.log(`[HNS] Created Trip for ${date} (Start: ${startTime})`);
    }
  }

  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey || this.googleApiKey.includes('AIza')) {
          try {
              const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
              const res = await fetch(url);
              const data = await res.json();
              if (data.routes?.[0]?.legs?.[0]) {
                  return { distance: data.routes[0].legs[0].distance.value, duration: data.routes[0].legs[0].duration.value };
              }
          } catch (e) { console.error('Maps API Error', e); }
      }
      return null;
  }

  private parseTime(timeStr: string): number {
      if (!timeStr) return 9999;
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!match) return 9999;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      if (match[3]?.toUpperCase() === 'PM' && h < 12) h += 12;
      if (match[3]?.toUpperCase() === 'AM' && h === 12) h = 0;
      return h * 60 + m;
  }

  private minutesToTime(minutes: number): string {
      if (minutes < 0) minutes = 0;
      const h = Math.floor(minutes / 60);
      const m = Math.floor(minutes % 60);
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

  private extractIds(html: string) {
    const ids = new Set<string>();
    const re = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    return Array.from(ids);
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