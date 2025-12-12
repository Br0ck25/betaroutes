// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Ensure KV bindings exist (mock in dev using FILE store)
	if (dev) {
        // [!code changed] Dynamic Import for Safety
        // This ensures 'node:fs' is never loaded in Production Workers
		const { setupMockKV } = await import('$lib/server/dev-mock-db');
        setupMockKV(event);
	}

	// 2. User auth logic
	const token = event.cookies.get('token');

	if (!token) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
		const usersKV = event.platform?.env?.BETA_USERS_KV;
		if (usersKV) {
			const userDataStr = await usersKV.get(token);

			if (userDataStr) {
				const userData = JSON.parse(userDataStr);
				
				event.locals.user = {
					id: userData.id,
					token,
					plan: userData.plan ?? 'free',
					tripsThisMonth: userData.tripsThisMonth ?? 0,
					maxTrips: userData.maxTrips ?? 10,
					resetDate: userData.resetDate ?? new Date().toISOString(),
					name: userData.name, 
					email: userData.email
				};
			} else {
				// Don't warn if just checking root, prevents log spam
                if (event.url.pathname.startsWith('/dashboard')) {
				    console.warn('[HOOK] Token exists but user not found in KV.');
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