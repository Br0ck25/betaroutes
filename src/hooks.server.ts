// src/hooks.server.ts
import { dev } from '$app/environment';

// Simple in-memory KV mock for local development
function createMockKV() {
    const store = new Map();

    return {
        async get(key) {
            return store.get(key) ?? null;
        },
        async put(key, value) {
            store.set(key, value);
        },
        async delete(key) {
            store.delete(key);
        },
        async list({ prefix }) {
            const keys = [...store.keys()].filter(k => k.startsWith(prefix));
            return {
                keys: keys.map((name) => ({ name }))
            };
        }
    };
}

export const handle = async ({ event, resolve }) => {
    console.log('[HOOK] ===== HOOK EXECUTING =====');
    console.log('[HOOK] Request URL:', event.url.pathname);

    // ------------------------------------------------------
    // 🔥 1. Ensure KV bindings exist (mock in dev only)
    // ------------------------------------------------------
    if (dev) {
        console.log('[HOOK] Using MOCK KV (local dev mode)');

        if (!event.platform) event.platform = {};
        if (!event.platform.env) event.platform.env = {};

        // User KV
        if (!event.platform.env.BETA_USERS_KV) {
            event.platform.env.BETA_USERS_KV = createMockKV();
        }

        // Trips KV
        if (!event.platform.env.BETA_LOGS_KV) {
            event.platform.env.BETA_LOGS_KV = createMockKV();
        }

        // Trash KV
        if (!event.platform.env.BETA_LOGS_TRASH_KV) {
            event.platform.env.BETA_LOGS_TRASH_KV = createMockKV();
        }
    }

    // ------------------------------------------------------
    // 🔥 2. User auth exactly as you had it
    // ------------------------------------------------------
    const token = event.cookies.get('token');
    console.log('[HOOK] Token from cookie:', token ? `exists (${token})` : 'missing');

    if (!token) {
        console.log('[HOOK] No token, setting user = null');
        event.locals.user = null;
        return resolve(event);
    }

    try {
        console.log('[HOOK] Looking up user in BETA_USERS_KV...');

        const usersKV = event.platform?.env?.BETA_USERS_KV;

        if (!usersKV) {
            throw new Error("BETA_USERS_KV is not bound in environment");
        }

        const userDataStr = await usersKV.get(token);
        console.log('[HOOK] Raw KV lookup result:', userDataStr);

        if (userDataStr) {
            const userData = JSON.parse(userDataStr);

            event.locals.user = {
                token,
                plan: userData.plan ?? "free",
                tripsThisMonth: userData.tripsThisMonth ?? 0,
                maxTrips: userData.maxTrips ?? 10,
                resetDate: userData.resetDate ?? new Date().toISOString()
            };

            console.log('[HOOK] User set from KV');
        } else {
            console.log('[HOOK] No KV entry for token — using fallback values');

            event.locals.user = {
                token,
                plan: 'free',
                tripsThisMonth: 0,
                maxTrips: 10,
                resetDate: new Date().toISOString()
            };
        }

    } catch (err) {
        console.error('[HOOK] ERROR accessing BETA_USERS_KV:', err);

        event.locals.user = {
            token,
            plan: 'free',
            tripsThisMonth: 0,
            maxTrips: 10,
            resetDate: new Date().toISOString()
        };
    }

    console.log('[HOOK] Final locals.user:', event.locals.user ? 'SET' : 'NULL');
    console.log('[HOOK] ===== HOOK COMPLETE =====');

    return resolve(event);
};
