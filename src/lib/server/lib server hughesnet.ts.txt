// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { Trip, Destination } from '$lib/types';
import { makeTripService } from './tripService';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';

export class HughesNetService {
  constructor(
    private kv: KVNamespace, 
    private encryptionKey: string,
    private tripKV: KVNamespace,
    private settingsKV: KVNamespace,
    private googleApiKey: string
  ) {}

  /**
   * Connects and verifies credentials
   */
  async connect(userId: string, username: string, password: string) {
    if (!userId || !username || !password) throw new Error('Missing fields');
    
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    const cookie = await this.loginAndStoreSession(userId, username, password);
    return !!cookie;
  }

  /**
   * Syncs orders from HNS and creates Trips
   */
  async sync(userId: string) {
    const cookie = await this.ensureSessionCookie(userId);
    if (!cookie) throw new Error('Could not login. Please check credentials.');

    // 1. Fetch Home and get IDs
    const homeRes = await fetch(HOME_URL, { headers: { 'Cookie': cookie }});
    const homeHtml = await homeRes.text();
    const ids = this.extractIdsFromHome(homeHtml);
    
    await this.kv.put(`hns:orders_index:${userId}`, JSON.stringify(ids));

    // 2. Fetch details for each ID
    const orders: any[] = [];
    for (const id of ids) {
      try {
        const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
        const res = await fetch(orderUrl, { headers: { 'Cookie': cookie }});
        const html = await res.text();
        const parsed = this.parseOrderPage(html, id);
        
        // Save raw order
        await this.kv.put(`hns:orders:${userId}:${id}`, JSON.stringify(parsed), { expirationTtl: 60 * 60 * 24 * 7 });
        orders.push(parsed);
      } catch (err) {
        console.error(`Failed to sync order ${id}`, err);
      }
    }

    // 3. Process orders into Trips
    await this.createTripsFromOrders(userId, orders);

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

  // --- Trip Creation Logic ---

  private async createTripsFromOrders(userId: string, orders: any[]) {
    const tripService = makeTripService(this.tripKV, undefined); // Pass undefined for trash if not needed here
    
    // Get User Settings for Start Address
    const settingsRaw = await this.settingsKV.get(`BETA_USER_SETTINGS_KV:${userId}`);
    const settings = settingsRaw ? JSON.parse(settingsRaw as string) : {};
    const defaultStartAddress = settings.defaultStartAddress || '';

    // Group orders by Date
    const ordersByDate: Record<string, any[]> = {};
    for (const order of orders) {
      if (!order.confirmScheduleDate) continue;
      
      // Convert 12/10/2025 -> 2025-12-10
      const dateParts = order.confirmScheduleDate.split('/');
      if (dateParts.length !== 3) continue;
      const isoDate = `${dateParts[2]}-${dateParts[0].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}`;
      
      if (!ordersByDate[isoDate]) ordersByDate[isoDate] = [];
      ordersByDate[isoDate].push(order);
    }

    // Process each day
    for (const [date, daysOrders] of Object.entries(ordersByDate)) {
      // Check if trip already exists for this date to avoid duplicates
      // (This is a simple check, could be more robust)
      const existingTrips = await tripService.list(userId);
      if (existingTrips.some(t => t.date === date)) {
        console.log(`Trip for ${date} already exists, skipping.`);
        continue;
      }

      // Find earliest start time
      let earliestOrder = daysOrders[0];
      let minMinutes = Infinity;

      for (const order of daysOrders) {
        const minutes = this.parseTime(order.beginTime);
        if (minutes < minMinutes) {
            minMinutes = minutes;
            earliestOrder = order;
        }
      }

      // Calculate Drive Time
      let driveTimeMinutes = 0;
      let distanceMiles = 0;
      
      if (defaultStartAddress && earliestOrder.address) {
         const route = await this.getRouteInfo(defaultStartAddress, `${earliestOrder.address}, ${earliestOrder.city}, ${earliestOrder.state}`);
         if (route) {
             driveTimeMinutes = Math.round(route.duration / 60);
             distanceMiles = Number((route.distance * 0.000621371).toFixed(1));
         }
      }

      // Calculate Trip Start Time (Job Start - Drive Time)
      const jobStartMinutes = minMinutes !== Infinity ? minMinutes : 9 * 60; // Default to 9am if parsing fails
      const tripStartMinutes = jobStartMinutes - driveTimeMinutes;
      
      // Format Times (HH:MM)
      const startTime = this.minutesToTime(tripStartMinutes);
      const endTime = "17:00"; // Always 5 PM

      // Build Destinations
      const destinations: Destination[] = daysOrders.map(o => ({
          address: `${o.address}, ${o.city}, ${o.state}`,
          earnings: 0,
          notes: `Order #${o.id}`
      }));

      // Create Trip Object
      const newTrip: any = { // Using any to bypass strict type checking for now, but matches interface
        id: crypto.randomUUID(),
        userId,
        date: date,
        startClock: startTime,
        endClock: endTime,
        startAddress: defaultStartAddress || 'Unknown',
        endAddress: defaultStartAddress || 'Unknown', // Assuming loop back home
        destinations,
        stops: daysOrders.map((o, i) => ({
            id: crypto.randomUUID(),
            address: `${o.address}, ${o.city}, ${o.state}`,
            earnings: 0,
            order: i,
            notes: `HNS ID: ${o.id}`
        })),
        totalMileage: distanceMiles * 2, // Rough estimate (there and back)
        fuelCost: 0, // Should be calculated if MPG exists
        maintenanceCost: 0,
        suppliesCost: 0,
        netProfit: 0,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        syncStatus: 'synced'
      };

      // Save Trip
      await tripService.put(newTrip);
      console.log(`Created trip for ${date} with ${daysOrders.length} orders`);
    }
  }

  // --- Helpers ---

  private async getRouteInfo(origin: string, destination: string) {
      if (!this.googleApiKey) return null;
      try {
          const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${this.googleApiKey}`;
          const res = await fetch(url);
          const data = await res.json();
          
          if (data.routes && data.routes.length > 0 && data.routes[0].legs) {
              const leg = data.routes[0].legs[0];
              return {
                  distance: leg.distance.value, // meters
                  duration: leg.duration.value  // seconds
              };
          }
      } catch (e) {
          console.error('Google Maps API Error', e);
      }
      return null;
  }

  private parseTime(timeStr: string): number {
      if (!timeStr) return 9999;
      // Handle "11:00", "11:00 AM", "08:30"
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!match) return 9999;
      
      let hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      const meridiem = match[3]?.toUpperCase();

      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;

      return hour * 60 + minute;
  }

  private minutesToTime(minutes: number): string {
      // Normalize negative minutes (if drive time > start time of day, technically implies previous day, but we'll clamp to 00:00)
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual'
    });

    let cookie = this.extractCookie(res);
    
    if (!cookie && res.status === 302) {
        const loc = res.headers.get('location') || '';
        const full = loc.startsWith('http') ? loc : `https://dwayinstalls.hns.com${loc}`;
        const res2 = await fetch(full, { method: 'GET', headers: { 'Referer': LOGIN_URL }, redirect: 'manual' });
        cookie = this.extractCookie(res2);
    }

    if (cookie) {
      await this.kv.put(`hns:session:${userId}`, cookie, { expirationTtl: 60 * 60 * 24 * 2 });
    }
    return cookie;
  }

  private extractCookie(res: Response) {
    const h = res.headers.get('set-cookie');
    if (!h) return null;
    return h.split(/,(?=[^;]+=)/g).map(p => p.split(';')[0].trim()).filter(Boolean).join('; ');
  }

  private extractIdsFromHome(html: string) {
    const re = /viewservice\.jsp\?snb=SO_EST_SCHD&id=(\d+)/g;
    const ids = new Set<string>();
    let m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    return Array.from(ids);
  }

  private parseOrderPage(html: string, id: string) {
    const clean = (s: string) => s ? s.replace(/&nbsp;|&amp;/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : null;
    
    const out: any = { id, address: '', city: '', state: '', confirmScheduleDate: '', beginTime: '', raw: '' };
    
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
            if (m && m[1]) { 
                out[key] = clean(m[1]); 
                break; 
            }
        }
    }
    return out;
  }

  // --- Crypto ---
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