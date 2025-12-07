// src/routes/dashboard/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load = ({ locals, platform }) => {
	console.log('[DASHBOARD LAYOUT] Checking auth...');

	if (!locals.user) {
		throw redirect(303, '/login');
	}

	// 1. Try Cloudflare Platform Env (Production)
	let apiKey = (platform?.env as any)?.PUBLIC_GOOGLE_MAPS_API_KEY;
	if (apiKey) console.log('[SERVER] Found key in platform.env');

	// 2. Try Svelte Dynamic Env (Local/Fallback)
	if (!apiKey) {
		apiKey = env.PUBLIC_GOOGLE_MAPS_API_KEY;
		if (apiKey) console.log('[SERVER] Found key in $env/dynamic/public');
	}

	// 3. Try Process Env (Node/Vercel/Netlify fallback)
	if (!apiKey && typeof process !== 'undefined') {
		apiKey = process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
		if (apiKey) console.log('[SERVER] Found key in process.env');
	}

	if (!apiKey) {
		console.error('❌ [SERVER] CRITICAL: Google Maps API Key is MISSING in all environments!');
	}

	return {
		user: locals.user,
		googleMapsApiKey: apiKey || ''
	};
};
