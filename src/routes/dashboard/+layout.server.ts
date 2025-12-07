// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load = ({ locals, platform }) => {
	console.log('[DASHBOARD LAYOUT] Checking auth...');

	if (!locals.user) {
		console.log('[DASHBOARD LAYOUT] No user found, redirecting to login');
		throw redirect(303, '/login');
	}

	// ROBUST KEY RETRIEVAL: Check Svelte env first, then Cloudflare platform env fallback
	const googleMapsApiKey =
		env.PUBLIC_GOOGLE_MAPS_API_KEY || (platform?.env as any)?.PUBLIC_GOOGLE_MAPS_API_KEY || '';

	console.log('[DASHBOARD LAYOUT] User authenticated, loading dashboard');

	return {
		user: locals.user,
		googleMapsApiKey // <--- Passing the key to the client
	};
};
