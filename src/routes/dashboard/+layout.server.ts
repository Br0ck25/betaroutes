// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { log } from '$lib/server/log';

export const load = async ({ locals, platform }) => {
	log.info('[DASHBOARD LAYOUT] Checking auth');

	if (!locals.user) {
		log.info('[DASHBOARD LAYOUT] No user found, redirecting to login');
		throw redirect(303, '/login');
	}

	// [!code fix] Prioritize PUBLIC key for the Frontend (Browser)
	// 1. Try to get a Public key (safe for browser)
	let clientApiKey = publicEnv.PUBLIC_GOOGLE_MAPS_API_KEY;

	// 2. If missing, check if we accidentally have the private key exposed (Dev fallback)
	if (!clientApiKey) {
		// Try Cloudflare Platform Env (Private) or Dynamic Private Env
		const { getEnv } = await import('$lib/server/env');
		const env = getEnv(platform);
		const privateKey =
			(env as any)['PRIVATE_GOOGLE_MAPS_API_KEY'] || privateEnv.PRIVATE_GOOGLE_MAPS_API_KEY;
		if (privateKey) {
			log.warn('Using PRIVATE key for frontend; this is discouraged', {
				note: 'This may fail if IP-restricted'
			});
			clientApiKey = privateKey;
		}
	}

	log.info('[DASHBOARD LAYOUT] Frontend Key status', {
		status: clientApiKey ? 'Loaded' : 'MISSING'
	});

	return {
		user: locals.user,
		googleMapsApiKey: clientApiKey
	};
};
