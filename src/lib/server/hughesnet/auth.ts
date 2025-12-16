// src/lib/server/hughesnet/auth.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { HughesNetFetcher } from './fetcher';
import { BASE_URL } from './parser';

const LOGIN_URL = 'https://dwayinstalls.hns.com/start/login.jsp?UsrAction=submit';
const HOME_URL = 'https://dwayinstalls.hns.com/start/Home.jsp';

export class HughesNetAuth {
    constructor(
        private kv: KVNamespace,
        private encryptionKey: string,
        private fetcher: HughesNetFetcher
    ) {}

    async connect(userId: string, username: string, password: string) {
        const payload = { username, password, loginUrl: LOGIN_URL, createdAt: new Date().toISOString() };
        const enc = await this.encrypt(JSON.stringify(payload));
        await this.kv.put(`hns:cred:${userId}`, enc);

        const cookie = await this.loginAndStoreSession(userId, username, password);
        if (!cookie) return false;

        try {
            const verifyRes = await this.fetcher.safeFetch(HOME_URL, { 
                headers: { 'Cookie': cookie }
            });
            const verifyHtml = await verifyRes.text();
            if (verifyHtml.includes('name="Password"') || verifyHtml.includes('login.jsp')) return false;
            return true;
        } catch (e) { return false; }
    }

    async disconnect(userId: string) {
        await this.kv.delete(`hns:session:${userId}`);
        await this.kv.delete(`hns:cred:${userId}`);
        await this.kv.delete(`hns:db:${userId}`);
        return true;
    }

    async ensureSessionCookie(userId: string) {
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
        
        const res = await this.fetcher.safeFetch(LOGIN_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
            body: form.toString(), 
            redirect: 'manual' 
        });
        
        let cookie = this.extractCookie(res);
        
        if (!cookie && res.status === 302) {
            const location = res.headers.get('location');
            const nextUrl = location ? (location.startsWith('http') ? location : `${BASE_URL}${location}`) : HOME_URL;
            const res2 = await this.fetcher.safeFetch(nextUrl, { 
                method: 'GET', 
                headers: { 'Referer': LOGIN_URL },
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