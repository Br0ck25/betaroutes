// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
// [!code fix] Import the rate limiter
import { checkRateLimit } from '$lib/server/rateLimit';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform, cookies, getClientAddress }) => {
    try {
        // 1. Get bindings first
        const kv = platform?.env?.BETA_USERS_KV;
        const sessionKv = platform?.env?.BETA_SESSIONS_KV;

        if (!kv || !sessionKv) {
             console.error('KV Binding Missing. Check wrangler.toml');
             return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // [!code fix] 2. Rate Limiting (Prevent Credential Stuffing)
        // Use CF-Connecting-IP for accurate Cloudflare IPs, fallback to SvelteKit default
        const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
        
        // Rule: 5 Login attempts per 60 seconds per IP
        const limitResult = await checkRateLimit(kv, clientIp, 'login_attempt', 5, 60);

        if (!limitResult.allowed) {
            return json({ 
                error: 'Too many login attempts. Please try again in a minute.' 
            }, { status: 429 });
        }

        // 3. Parse Body (Only proceed if rate limit passes)
        const { email, password } = await request.json();

        // 4. Authenticate
        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 5. Fetch Full User details
        const fullUser = await findUserById(kv, authResult.id);
        const now = new Date().toISOString();
        
        // 6. Prepare Session Data
        const sessionData = {
            id: authResult.id,
            name: authResult.username,
            email: authResult.email,
            plan: fullUser?.plan || 'free',
            tripsThisMonth: fullUser?.tripsThisMonth || 0,
            maxTrips: fullUser?.maxTrips || 10,
            resetDate: fullUser?.resetDate || now,
            role: fullUser?.role || 'user'
        };

        // 7. Create Session in SESSIONS_KV
        const sessionId = await createSession(sessionKv, sessionData);
        
        // 8. Set Cookie
        cookies.set('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: !dev, 
            maxAge: 60 * 60 * 24 * 7 
        });

        return json({ user: sessionData });

    } catch (err) {
        console.error('Login error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};