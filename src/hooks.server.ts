// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Ensure KV bindings exist (mock in dev using FILE store)
	if (dev) {
		const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
	}

	// 2. User auth logic: Check for 'session_id' cookie
	const sessionId = event.cookies.get('session_id');

    // [!code fix] Regex for UUID v4 validation
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // [!code fix] Validate format before trusting the cookie to avoid wasting KV reads
	if (!sessionId || !UUID_REGEX.test(sessionId)) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
        // [!code fix] Use SESSIONS_KV to find the active session
		const sessionKV = event.platform?.env?.BETA_SESSIONS_KV;
		
        if (sessionKV) {
			const sessionDataStr = await sessionKV.get(sessionId);

			if (sessionDataStr) {
				const session = JSON.parse(sessionDataStr);
				
				event.locals.user = {
					id: session.id,
					token: sessionId,
					plan: session.plan ?? 'free',
					tripsThisMonth: session.tripsThisMonth ?? 0,
					maxTrips: session.maxTrips ?? 10,
					resetDate: session.resetDate ?? new Date().toISOString(),
					name: session.name, 
					email: session.email
				};
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