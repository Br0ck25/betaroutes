// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
// [!code ++] Import the user finder
import { findUserById } from '$lib/server/userService'; 

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Ensure KV bindings exist (mock in dev using FILE store)
    if (dev) {
        const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
    }

    // 2. User auth logic: Check for 'session_id' cookie
    const sessionId = event.cookies.get('session_id');
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!sessionId || !UUID_REGEX.test(sessionId)) {
        event.locals.user = null;
        return resolve(event);
    }

    try {
        const sessionKV = event.platform?.env?.BETA_SESSIONS_KV;
        // [!code ++] Access the Users KV to get fresh data
        const usersKV = event.platform?.env?.BETA_USERS_KV;

        if (sessionKV) {
            const sessionDataStr = await sessionKV.get(sessionId);

            if (sessionDataStr) {
                const session = JSON.parse(sessionDataStr);
                
                // [!code ++] FETCH FRESH USER DATA
                // This ensures we see the Upgrade immediately without re-login
                let freshPlan = session.plan ?? 'free';
                let freshStripeId = session.stripeCustomerId;
                let freshMaxTrips = session.maxTrips ?? 10;

                if (usersKV && session.id) {
                    const freshUser = await findUserById(usersKV, session.id);
                    if (freshUser) {
                        freshPlan = freshUser.plan;
                        freshStripeId = freshUser.stripeCustomerId;
                        freshMaxTrips = freshUser.maxTrips;
                    }
                }

                event.locals.user = {
                    id: session.id,
                    token: sessionId,
                    // [!code fix] Use the FRESH values
                    plan: freshPlan,
                    tripsThisMonth: session.tripsThisMonth ?? 0, // Keep session counter
                    maxTrips: freshMaxTrips,
                    resetDate: session.resetDate ?? new Date().toISOString(),
                    name: session.name,
                    email: session.email,
                    stripeCustomerId: freshStripeId // [!code ++] Critical for Portal button
                };
            } else {
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