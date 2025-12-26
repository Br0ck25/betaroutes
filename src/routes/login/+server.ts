// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { makeTripService } from '$lib/server/tripService';
import { checkRateLimit } from '$lib/server/rateLimit';
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request, platform, cookies, getClientAddress }) => {
    try {
        const env = platform?.env;
        const kv = env?.BETA_USERS_KV;
        const sessionKv = env?.BETA_SESSIONS_KV;

        // 1. Check Bindings
        if (!kv || !sessionKv) {
             console.error('KV Binding Missing. Check wrangler.toml');
             if (!dev) return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // 2. Rate Limiting (Prevent Credential Stuffing)
        // Skip this check in dev mode to prevent localhost lockouts
        if (kv && !dev) {
            const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
            
            // Rule: 5 Login attempts per 60 seconds per IP
            const limitResult = await checkRateLimit(kv, clientIp, 'login_attempt', 5, 60);

            if (!limitResult.allowed) {
                return json({ 
                    error: 'Too many login attempts. Please try again in a minute.' 
                }, { status: 429 });
            }
        }

        // 3. Parse Body
        const { email, password } = await request.json();

        // 4. Authenticate
        // @ts-ignore
        const authResult = await authenticateUser(kv, email, password);
        
        if (!authResult) {
            return json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // 5. Fetch Full User details
        // @ts-ignore
        const fullUser = await findUserById(kv, authResult.id);
        const now = new Date().toISOString();
        
        // 6. Prepare Session Data
        const sessionData = {
            id: authResult.id,
            // [!code fix] Use the display name (e.g. "James") if available, otherwise fallback to username
            name: fullUser?.name || authResult.username,
            email: authResult.email,
            plan: fullUser?.plan || 'free',
            tripsThisMonth: fullUser?.tripsThisMonth || 0,
            maxTrips: fullUser?.maxTrips || 10,
            resetDate: fullUser?.resetDate || now,
            role: (fullUser as any)?.role || 'user'
        };

        // 7. Create Session in SESSIONS_KV
        // @ts-ignore
        const sessionId = await createSession(sessionKv, sessionData);
        
        // 8. Set Cookie
        cookies.set('session_id', sessionId, {
            path: '/',
            httpOnly: true,
            sameSite: 'none',
            secure: true,
            maxAge: 60 * 60 * 24 * 7 
        });

        // 9. AUTO-MIGRATION
        // Move legacy data (username key) to new storage (UUID key) in background
        if (platform?.context && env?.BETA_LOGS_KV && env?.TRIP_INDEX_DO) {
            const userId = authResult.id;
            const username = authResult.username;

            platform.context.waitUntil((async () => {
                try {
                    const svc = makeTripService(
                        env.BETA_LOGS_KV,
                        env.BETA_LOGS_TRASH_KV,
                        env.BETA_PLACES_KV,
                        env.TRIP_INDEX_DO
                    );
                    
                    // Trigger the move. If keys exist under 'username', they move to 'userId'.
                    await svc.migrateUser(username, userId);
                    
                } catch (e) {
                    console.error(`[Auto-Migration] Failed for ${username}:`, e);
                }
            })());
        }

        return json({ user: sessionData });

    } catch (err) {
        console.error('Login error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};