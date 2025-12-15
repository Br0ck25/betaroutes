// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Setup Mock DB in Dev
	if (dev) {
		const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
	}

	// 2. Check for the correct 'session_id' cookie
	const sessionId = event.cookies.get('session_id');

	if (!sessionId) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
        // 3. Look up session in SESSIONS_KV
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
                // Cookie exists but session is gone from DB
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