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

	if (!sessionId) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
        // Using BETA_USERS_KV to look up the session
		const usersKV = event.platform?.env?.BETA_USERS_KV;
		if (usersKV) {
			const sessionDataStr = await usersKV.get(sessionId);

			if (sessionDataStr) {
				const session = JSON.parse(sessionDataStr);
				
				event.locals.user = {
					id: session.id,
					token: sessionId, // Keep session ID available as token
					plan: session.plan ?? 'free',
					tripsThisMonth: session.tripsThisMonth ?? 0,
					maxTrips: session.maxTrips ?? 10,
					resetDate: session.resetDate ?? new Date().toISOString(),
					name: session.name, // This contains the username
					email: session.email
				};
			} else {
				// Session invalid or expired in KV
                if (event.url.pathname.startsWith('/dashboard')) {
				    console.warn('[HOOK] Session ID exists but not found in KV.');
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