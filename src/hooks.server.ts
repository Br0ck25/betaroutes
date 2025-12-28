// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
// [!code ++] Import the user finder to check real-time status
import { findUserById } from '$lib/server/userService'; 

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Ensure KV bindings exist (mock in dev using FILE store)
    if (dev) {
        const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
    }

    // 2. User auth logic: Check for 'session_id' cookie
    const sessionId = event.cookies.get('session_id');

    // Regex for UUID v4 validation (Strict)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Validate format before trusting the cookie to avoid wasting KV reads
    // If no cookie or invalid format, skip KV lookup entirely
    if (!sessionId || !UUID_REGEX.test(sessionId)) {
        event.locals.user = null;
        return resolve(event);
    }

    try {
        // [!code fix] Get both Session KV and Users KV via helper
        const { getEnv, safeKV } = await import('$lib/server/env');
        const env = getEnv(event.platform);
        const sessionKV = safeKV(env, 'BETA_SESSIONS_KV');
        const usersKV = safeKV(env, 'BETA_USERS_KV');

        if (sessionKV) {
            const sessionDataStr = await sessionKV.get(sessionId);

            if (sessionDataStr) {
                const session = JSON.parse(sessionDataStr);

                // [!code ++] FETCH FRESH USER DATA
                // Assume session is stale; check the main DB for the absolute latest plan
                let freshPlan = session.plan ?? 'free';
                let freshStripeId = session.stripeCustomerId;
                let freshMaxTrips = session.maxTrips ?? 10;

                if (usersKV && session.id) {
                    try {
                        const freshUser = await findUserById(usersKV, session.id);
                        if (freshUser) {
                            freshPlan = freshUser.plan;
                            freshStripeId = freshUser.stripeCustomerId;
                            // Only update maxTrips if the user record has it, otherwise keep session's
                            if (freshUser.maxTrips) freshMaxTrips = freshUser.maxTrips;
                        }
                    } catch (e) {
                        console.error('[HOOK] Failed to fetch fresh user data:', e);
                    }
                }

                event.locals.user = {
                    id: session.id,
                    token: sessionId,
                    // [!code fix] Use the FRESH values from DB
                    plan: freshPlan, 
                    tripsThisMonth: session.tripsThisMonth ?? 0,
                    maxTrips: freshMaxTrips,
                    resetDate: session.resetDate ?? new Date().toISOString(),
                    name: session.name,
                    email: session.email,
                    stripeCustomerId: freshStripeId // [!code ++] Required for Portal
                } as any;
            } else {
                // Session ID cookie exists, but data is gone from KV (expired/deleted)
                if (event.url.pathname.startsWith('/dashboard')) {
                    console.warn('[HOOK] Session expired or invalid.');
                }
                event.locals.user = null;
            }
        }
    } catch (err) {
        console.error('[HOOK] KV Error:', err);
        event.locals.user = null;
    }

    return resolve(event);
};