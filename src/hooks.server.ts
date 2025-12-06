// src/hooks.server.ts

export const handle = async ({ event, resolve }) => {
    console.log('[HOOK] ===== HOOK EXECUTING =====');
    console.log('[HOOK] Request URL:', event.url.pathname);

    const token = event.cookies.get('token');
    console.log('[HOOK] Token from cookie:', token ? `exists (${token})` : 'missing');

    // If no token, user remains unauthenticated
    if (!token) {
        console.log('[HOOK] No token, setting user = null');
        event.locals.user = null;
        return resolve(event);
    }

    // Token exists — try to look up user in KV
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

            console.log('[HOOK] KV user loaded:', userData);

            event.locals.user = {
                token,
                plan: userData.plan ?? "free",
                tripsThisMonth: userData.tripsThisMonth ?? 0,
                maxTrips: userData.maxTrips ?? 10,
                resetDate: userData.resetDate ?? new Date().toISOString()
            };

            console.log('[HOOK] User set from KV');
        } else {
            // KV entry not found — fallback defaults
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

        // KV lookup failed — still allow user with fallback data
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
