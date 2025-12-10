// src/lib/server/hughesnet.ts
import type { KVNamespace } from '@cloudflare/workers-types';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';

export class HughesNetService {
  constructor(private kv: KVNamespace, private encryptionKey: string) {}

  /**
   * Encrypts and stores credentials, then verifies login.
   */
  async connect(userId: string, username: string, password: string) {
    if (!userId || !username || !password) throw new Error('Missing fields');
    
    // Store credentials
    const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
    const enc = await this.encrypt(JSON.stringify(payload));
    await this.kv.put(`hns:cred:${userId}`, enc);

    // Initial Login Test
    const cookie = await this.loginAndStoreSession(userId, username, password);
    return !!cookie;
  }

  /**
   * Retrieves all cached orders for a user.
   */
  async getOrders(userId: string) {
    const indexRaw = await this.kv.get(`hns:orders_index:${userId}`);
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    const results: Record<string, any> = {};
    
    for (const id of index) {
      const v = await this.kv.get(`hns:orders:${userId}:${id}`);
      if (v) {
        try { results[id] = JSON.parse(v); } catch(e) { results[id] = v; }
      }
    }
    return results;
  }

  /**
   * Logs in and scrapes the latest data from HNS.
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
    const results = [];
    for (const id of ids) {
      try {
        const orderUrl = `https://dwayinstalls.hns.com/forms/viewservice.jsp?snb=SO_EST_SCHD&id=${encodeURIComponent(id)}`;
        const res = await fetch(orderUrl, { headers: { 'Cookie': cookie }});
        
        if (res.status === 302 || res.status === 403) {
           // Retry logic could go here if session expires mid-sync
        }

        const html = await res.text();
        const parsed = this.parseOrderPage(html, id);
        
        await this.kv.put(`hns:orders:${userId}:${id}`, JSON.stringify(parsed), { expirationTtl: 60 * 60 * 24 * 7 });
        results.push(parsed);
      } catch (err) {
        console.error(`Failed to sync order ${id}`, err);
      }
    }
    return results;
  }

  // --- Helpers ---

  private async ensureSessionCookie(userId: string) {
    const session = await this.kv.get(`hns:session:${userId}`);
    if (session) return session;
    
    // Decrypt creds to relogin
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
    
    // Follow redirect if needed
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
    
    const out: any = { id, address: '', city: '', state: '', confirmScheduleDate: '', raw: '' };
    
    // Simple extraction logic
    const patterns: Record<string, RegExp[]> = {
      address: [/Address:\s*<\/?[^>]*>([^<\r\n]+)/i, /<b>\s*Address\s*<\/b>[:\s]*<\/?[^>]*>\s*([^<\r\n]+)/i],
      city: [/City:\s*<\/?[^>]*>([^<\r\n]+)/i, /City[:\s]*<\/?[^>]*>\s*<td[^>]*>([^<\r\n]+)/i],
      state: [/State\/Cnty:\s*<\/?[^>]*>([^<\r\n]+)/i],
      confirmScheduleDate: [/Confirm Schedule Date:\s*<\/?[^>]*>([^<\r\n]+)/i]
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