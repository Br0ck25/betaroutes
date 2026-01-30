// src/lib/server/hughesnet/auth.ts

import type { HughesNetFetcher } from './fetcher';
import { BASE_URL } from './parser';
import { log } from '$lib/server/log';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';

export class HughesNetAuth {
  constructor(
    private kv: KVNamespace,
    private encryptionKey: string,
    private fetcher: HughesNetFetcher
  ) {}

  /**
   * Performs a fresh connection/login and stores encrypted credentials.
   */
  async connect(userId: string, username: string, password: string): Promise<boolean> {
    // Store credentials encrypted for future auto-logins
    const payload = {
      username,
      password,
      loginUrl: LOGIN_URL,
      createdAt: new Date().toISOString()
    };

    const enc = await this.encrypt(JSON.stringify(payload));
    if (!enc) return false;

    await this.kv.put(`hns:cred:${userId}`, enc);

    // Perform actual login
    const cookie = await this.loginAndStoreSession(userId, username, password);
    if (!cookie) return false;

    // Verify the session actually works by hitting the Home page
    try {
      const verifyRes = await this.fetcher.safeFetch(HOME_URL, {
        headers: { Cookie: cookie ?? '' }
      });
      const verifyHtml = await verifyRes.text();

      // If we see a password field or a login link, the session is invalid
      if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clears all session data and stored credentials for a user.
   */
  async disconnect(userId: string): Promise<boolean> {
    await Promise.all([
      this.kv.delete(`hns:session:${userId}`),
      this.kv.delete(`hns:cred:${userId}`),
      this.kv.delete(`hns:db:${userId}`)
    ]);
    return true;
  }

  /**
   * Returns a valid session cookie, logging in again if necessary.
   */
  async ensureSessionCookie(userId: string): Promise<string | null> {
    // 1. Try to get existing session
    const session = await this.kv.get(`hns:session:${userId}`);
    if (session) return session;

    // 2. If expired, try to re-login using stored credentials
    const enc = await this.kv.get(`hns:cred:${userId}`);
    if (!enc) return null;

    const credsJson = await this.decrypt(enc);
    if (!credsJson) return null;

    try {
      const creds = JSON.parse(credsJson);
      return this.loginAndStoreSession(userId, creds.username, creds.password);
    } catch {
      return null;
    }
  }

  private async loginAndStoreSession(
    userId: string,
    username: string,
    password: string
  ): Promise<string | null> {
    const form = new URLSearchParams();
    form.append('User', username);
    form.append('Password', password);
    form.append('Submit', 'Log In');
    form.append('ScreenSize', 'MED');
    form.append('AuthSystem', 'HNS');

    // Initial POST attempt
    const res = await this.fetcher.safeFetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual'
    });

    let cookie = this.extractCookie(res);

    // Handle 302 Redirect logic which is common in HNS auth flow
    if (!cookie && res.status === 302) {
      const location = res.headers.get('location');
      const nextUrl = location
        ? location.startsWith('http')
          ? location
          : `${BASE_URL}${location}`
        : HOME_URL;

      const res2 = await this.fetcher.safeFetch(nextUrl, {
        method: 'GET',
        headers: { Referer: LOGIN_URL },
        redirect: 'manual'
      });
      cookie = this.extractCookie(res2);
    }

    // Store session for 2 days if successful
    if (cookie) {
      await this.kv.put(`hns:session:${userId}`, cookie, { expirationTtl: 60 * 60 * 24 * 2 });
    }

    return cookie;
  }

  private extractCookie(res: Response): string | null {
    const h = res.headers?.get('set-cookie');
    if (!h) return null;
    // Standard parser for Cloudflare Response headers
    return h
      .split(/,(?=[^;]+=)/g)
      .map((p) => (p.split(';')[0] ?? '').trim())
      .filter(Boolean)
      .join('; ');
  }

  // --- Encryption ---

  private async encrypt(plain: string): Promise<string | null> {
    // SECURITY: Fail secure - never return plaintext when encryption key is missing
    if (!this.encryptionKey) {
      log.error('[HughesNet Auth] Cannot encrypt: encryption key not configured');
      return null;
    }
    try {
      const keyRaw = Uint8Array.from(atob(this.encryptionKey), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(plain)
      );
      const encBuf = enc as ArrayBuffer;

      const combined = new Uint8Array(iv.byteLength + encBuf.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encBuf), iv.byteLength);

      // Helper to convert binary to string for b64
      let binary = '';
      const bytes = new Uint8Array(combined);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(Number(bytes[i] ?? 0));
      }
      return btoa(binary);
    } catch {
      return null;
    }
  }

  private async decrypt(cipherB64: string): Promise<string | null> {
    // SECURITY: Fail secure - never return ciphertext as plaintext when encryption key is missing
    if (!this.encryptionKey) {
      log.error('[HughesNet Auth] Cannot decrypt: encryption key not configured');
      return null;
    }
    try {
      const binary = atob(cipherB64);
      const combined = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        combined[i] = binary.charCodeAt(i);
      }

      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const keyRaw = Uint8Array.from(atob(this.encryptionKey), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['decrypt']);
      const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

      return new TextDecoder().decode(dec);
    } catch {
      return null;
    }
  }
}
