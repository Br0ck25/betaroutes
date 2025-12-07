// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load = ({ locals, platform }) => {
	console.log('[DASHBOARD LAYOUT] Checking auth...');

	if (!locals.user) {
		console.log('[DASHBOARD LAYOUT] No user found, redirecting to login');
		throw redirect(303, '/login');
	}

	// 1. Try Cloudflare Platform Env
	let apiKey = (platform?.env as any)?.PUBLIC_GOOGLE_MAPS_API_KEY;

	// 2. Try Svelte Dynamic Env
	if (!apiKey) {
		apiKey = env.PUBLIC_GOOGLE_MAPS_API_KEY;
	}

	// 3. Fallback: Hardcode the key to ensure it works
	if (!apiKey) {
		console.warn('[SERVER] Env var missing, using hardcoded fallback.');
		apiKey = 'AIzaSyCOdfe7j11yw9ENkX8c7hYsIjwqcQeqJGQ';
	}

	console.log('[DASHBOARD LAYOUT] Key status:', apiKey ? 'Found' : 'MISSING');

	return {
		user: locals.user,
		googleMapsApiKey: apiKey
	};
};
