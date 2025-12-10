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
    
    // 1. Store credentials
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    // 2. Perform Login
    const cookie = await this.loginAndStoreSession(userId, username, password);
    if (!cookie) {
        console.error('[HNS] Login failed: No cookie received');
        return false;
    }

    // 3. Verify Login
    const verifyRes = await fetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT } });
    const verifyHtml = await verifyRes.text();
    
    if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) {
        console.error('[HNS] Verify failed: Still on login page');
        return false;
    }

    console.log('[HNS] Connection successful');
    return true;
  }

  async sync(userId: string) {
    console.log(`[HNS] Starting sync for ${userId}`);
    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login. Please check credentials.');

    // 1. Fetch Home Page (The Frameset)
    console.log(`[HNS] Fetching Home: ${HOME_URL}`);
    const res = await fetch(HOME_URL, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
    const html = await res.text();
    
    if (html.includes('name="Password"')) throw new Error('Session expired. Please reconnect.');

    // 2. CHECK FOR ALL FRAMES (Header, Body, etc.)
    // We need to fetch EVERY frame to find where the orders are hiding.
    const frames = this.extractFrameUrls(html);
    const ids = new Set<string>();
    
    // Scan the main page first (just in case)
    const mainPageIds = this.extractIds(html);
    mainPageIds.forEach(id => ids.add(id));

    if (frames.length > 0) {
        console.log(`[HNS] Found ${frames.length} frames. Scanning all of them...`);
        
        for (const frameUrl of frames) {
            try {
                console.log(`[HNS] Scanning Frame: ${frameUrl}`);
                const frameRes = await fetch(frameUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
                const frameHtml = await frameRes.text();
                
                const frameIds = this.extractIds(frameHtml);
                console.log(`   -> Found ${frameIds.length} orders in this frame.`);
                frameIds.forEach(id => ids.add(id));
            } catch (err) {
                console.error(`   -> Failed to fetch frame: ${frameUrl}`);
            }
        }
    }

    const uniqueIds = Array.from(ids);
    console.log(`[HNS] Total unique orders found: ${uniqueIds.length}`);
    
    await this.kv.put(`hns:orders_index:${userId}`, JSON.stringify(uniqueIds));

    // 3. Fetch details for each ID
    const orders: any[] = [];
    for (const id of uniqueIds) {
      try {
        const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
        
        const res = await fetch(orderUrl, { headers: { 'Cookie': cookie, 'User-Agent': USER_AGENT }});
        const orderHtml = await res.text();
        const parsed = this.parseOrderPage(orderHtml, id);
        
        // Only save if we actually got data back (sanity check)
        if (parsed.address || parsed.city) {
            await this.kv.put(`hns:orders:${userId}:${id}`, JSON.stringify(parsed));
            orders.push(parsed);
        } else {
            console.warn(`[HNS] Warning: Parsed order ${id} is empty. HTML might be unexpected.`);
        }

      } catch (err) {
        console.error(`[HNS] Failed to sync order ${id}`, err);
      }
    }

    // 4. Create Trips
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

  // --- HTML Parsing Helpers ---

  private extractFrameUrls(html: string): string[] {
    const urls: string[] = [];
    // Match <frame src="..."> and <iframe src="...">
    const re = /<(?:frame|iframe)[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let url = m[1];
        // Convert relative URL to absolute
        if (!url.startsWith('http')) {
            // Remove leading ./ or /
            url = url.replace(/^\.?\//, '');
            // Most frames are relative to /start/ or root. We'll try appending to BASE_URL + /start/ first if it looks like a JSP
            // But based on your link, it might be root relative.
            // Let's assume it is relative to the current page folder (/start/)
            url = `${BASE_URL}/start/${url}`; 
        }
        urls.push(url);
    }
    return urls;
  }

  private extractIds(html: string) {
    const ids = new Set<string>();
    
    // Clean HTML entities first to make matching easier (&amp; -> &)
    const cleanHtml = html.replace(/&amp;/g, '&');

    // 1. Precise Match (Based on the link you provided)
    // href="../forms/viewservice.jsp?snb=SO_EST_SCHD&id=14494193"
    // We match: viewservice.jsp? followed by anything, then id=NUMBERS
    const re1 = /viewservice\.jsp\?.*?\bid=(\d+)/gi;
    let m;
    while ((m = re1.exec(cleanHtml)) !== null) ids.add(m[1]);

    // 2. Fallback: Any parameter-like ID
    if (ids.size === 0) {
        const re2 = /[?&]id=(\d{7,10})\b/gi;
        while ((m = re2.exec(cleanHtml)) !== null) ids.add(m[1]);
    }

    return Array.from(ids);
  }

  // --- Trip Creation Logic ---
  private async createTripsFromOrders(userId: string, orders: any[]) {
    const tripService = makeTripService(this.tripKV, undefined);
    const settingsRaw = await this.settingsKV.get(`BETA_USER_SETTINGS_KV:${userId}`);
    const settings = settingsRaw ? JSON.parse(settingsRaw as string) : {};
    const defaultStartAddress = settings.defaultStartAddress || '';

    const ordersByDate: Record<string, any[]> = {};
    for (const order of orders) {
      if (!order.confirmScheduleDate) continue;
      const dateParts = order.confirmScheduleDate.split('/');
      if (dateParts.length !== 3) continue;
      const isoDate = `${dateParts[2]}-${dateParts[0].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}`;
      if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
      ordersByDate[isoDate].push(order);
    }

    for (const [date, daysOrders] of Object.entries(ordersByDate)) {
      const existingTrips = await tripService.list(userId);
      if (existingTrips.some(t => t.date === date)) {
          console.log(`[HNS] Trip already exists for ${date}`);
          continue;
      }

      let minMinutes = 9 * 60; 
      let earliestOrder = daysOrders[0];
      let hasTime = false;

      for (const order of daysOrders) {
        const m = this.parseTime(order.beginTime);
        if (m < 24 * 60) {
            if (!hasTime || m < minMinutes) {
                minMinutes = m;
                earliestOrder = order;
                hasTime = true;
            }
        }
      }

      let driveTimeMinutes = 0;
      let distanceMiles = 0;
      
      if (defaultStartAddress && earliestOrder.address) {
         const dest = `${earliestOrder.address}, ${earliestOrder.city}, ${earliestOrder.state}`;
         const route = await this.getRouteInfo(defaultStartAddress, dest);
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
        startAddress: defaultStartAddress || 'Unknown',
        endAddress: defaultStartAddress || 'Unknown',
        destinations: daysOrders.map(o => ({
          address: `${o.address}, ${o.city}, ${o.state}`,
          earnings: 0,
          notes: `HNS Order: ${o.id}`
        })),
        stops: daysOrders.map((o, i) => ({
            id: crypto.randomUUID(),
            address: `${o.address}, ${o.city}, ${o.state}`,
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
      console.log(`[HNS] Created Trip for ${date} with ${daysOrders.length} orders`);
    }
  }

  // --- Helpers ---
  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey || this.googleApiKey.includes('AIza')) {
          try {
              const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
              const res = await fetch(url);
              const data = await res.json();
              if (data.routes?.[0]?.legs?.[0]) {
                  return {
                      distance: data.routes[0].legs[0].distance.value,
                      duration: data.routes[0].legs[0].duration.value
                  };
              }
          } catch (e) { console.error('Maps API Error', e); }
      }
      return null;
  }

  private parseOrderPage(html: string, id: string) {
    const clean = (s: string) => s ? s.replace(/&nbsp;|&amp;/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : null;
    const out: any = { id, address: '', city: '', state: '', confirmScheduleDate: '', beginTime: '' };
    
    const patterns: Record<string, RegExp[]> = {
      address: [/Address:\s*<\/?[^>]*>([^<\r\n]+)/i, /<b>\s*Address\s*<\/b>[:\s]*<\/?[^>]*>\s*([^<\r\n]+)/i],
      city: [/City:\s*<\/?[^>]*>([^<\r\n]+)/i, /City[:\s]*<\/?[^>]*>\s*<td[^>]*>([^<\r\n]+)/i],
      state: [/State\/Cnty:\s*<\/?[^>]*>([^<\r\n]+)/i],
      confirmScheduleDate: [/Confirm Schedule Date:\s*<\/?[^>]*>([^<\r\n]+)/i, /Confirm Schedule Date[:\s]*([^<\r\n]+)/i],
      beginTime: [/Schd Est\. Begin Time:\s*<\/?[^>]*>([^<\r\n]+)/i, /Schd Est\.[^\r\n]*Begin Time[:\s]*([^<\r\n]+)/i]
    };

    for (const [key, pats] of Object.entries(patterns)) {
        for (const p of pats) {
            const m = p.exec(html);
            if (m && m[1]) { out[key] = clean(m[1]); break; }
        }
    }
    return out;
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

    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: form.toString(),
      redirect: 'manual'
    });

    let cookie = this.extractCookie(res);
    
    if (!cookie && res.status === 302) {
        const loc = res.headers.get('location') || '';
        const full = loc.startsWith('http') ? loc : `https://dwayinstalls.hns.com${loc}`;
        const res2 = await fetch(full, { method: 'GET', headers: { 'Referer': LOGIN_URL, 'User-Agent': USER_AGENT }, redirect: 'manual' });
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