// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { findUserById } from '$lib/server/userService';

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Ensure KV bindings exist (mock in dev)
    if (dev) {
        const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
    }

    // 2. Security Headers & Response Processing
    const response = await processAuth(event, resolve);
    
    // Add Global Security Headers
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    
    if (!dev) {
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    return response;
};

async function processAuth(event: any, resolve: any) {
    const sessionKV = event.platform?.env?.BETA_SESSIONS_KV;
    const usersKV = event.platform?.env?.BETA_USERS_KV;

    // Cookie name check
    const cookieName = dev ? 'session_id' : '__Host-session_id';
    const sessionId = event.cookies.get(cookieName);

    if (!sessionId || !sessionKV || !usersKV) {
        event.locals.user = null;
        return resolve(event);
    }

    try {
        const sessionDataStr = await sessionKV.get(sessionId);

        if (sessionDataStr) {
            const session = JSON.parse(sessionDataStr);
            
            // 3. Stale Data Fix: Fetch fresh permissions from USERS_KV
            // The session might contain old plan data. We use the session only for identity (ID).
            const freshUser = await findUserById(usersKV, session.id);

            if (freshUser) {
                event.locals.user = {
                    id: freshUser.id,
                    token: sessionId,
                    plan: freshUser.plan,
                    tripsThisMonth: freshUser.tripsThisMonth,
                    maxTrips: freshUser.maxTrips,
                    resetDate: freshUser.resetDate,
                    name: freshUser.name || freshUser.username, 
                    email: freshUser.email,
                    role: (freshUser as any).role || 'user'
                };

                // 4. Rolling Session Logic
                // If session is older than 1 day, refresh its TTL to 30 days
                const now = Date.now();
                const createdAt = session.createdAt || 0;
                if (now - createdAt > 1000 * 60 * 60 * 24) {
                    session.createdAt = now;
                    // Extend KV TTL
                    event.platform.context.waitUntil(
                        sessionKV.put(sessionId, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 30 })
                    );
                }

            } else {
                // User deleted but session exists
                event.locals.user = null;
            }
        } else {
            // Session ID exists in cookie but not in KV (expired)
            event.locals.user = null;
        }
    } catch (err) {
        console.error('[HOOK] Auth Error:', err);
        event.locals.user = null;
    }

    return resolve(event);
}