// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load = ({ locals, platform }) => {
	if (!locals.user) {
		throw redirect(303, '/login');
	}

	// 1. Try getting key from Cloudflare Platform object (Production)
	let apiKey = (platform?.env as any)?.PUBLIC_GOOGLE_MAPS_API_KEY;

	// 2. Fallback to Svelte dynamic env (Local Dev)
	if (!apiKey) {
		apiKey = env.PUBLIC_GOOGLE_MAPS_API_KEY;
	}

	// Debug Log (Check Cloudflare Functions logs if this fails)
	if (!apiKey) {
		console.error('❌ [SERVER] Google Maps API Key is MISSING!');
	} else {
		console.log('✅ [SERVER] Google Maps API Key found.');
	}

	return {
		user: locals.user,
		googleMapsApiKey: apiKey || ''
	};
};
