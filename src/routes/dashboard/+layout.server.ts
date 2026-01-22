// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { log } from '$lib/server/log';

export const load = async ({ locals }) => {
	log.info('[DASHBOARD LAYOUT] Checking auth');

	if (!locals.user) {
		log.info('[DASHBOARD LAYOUT] No user found, redirecting to login');
		throw redirect(303, '/login');
	}

	// Only use the PUBLIC key (safe for browser, has HTTP referrer restrictions)
	// SECURITY: Never send PRIVATE_GOOGLE_MAPS_API_KEY to the frontend
	const clientApiKey = publicEnv['PUBLIC_GOOGLE_MAPS_API_KEY'] || '';

	log.info('[DASHBOARD LAYOUT] Frontend Key status', {
		status: clientApiKey ? 'Loaded' : 'MISSING'
	});

	return {
		user: locals.user,
		googleMapsApiKey: clientApiKey
	};
};
