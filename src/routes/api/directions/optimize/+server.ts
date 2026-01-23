// src/routes/api/directions/optimize/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
	checkRateLimitEnhanced,
	createRateLimitHeaders,
	getClientIdentifier
} from '$lib/server/rateLimit';
import { safeKV } from '$lib/server/env';

/**
 * Helper: Server geocoding is handled via Google (geocode helper) — Photon removed.
 */

/**
 * Helper: Generate a unique key for the set of stops to cache the optimization result
 */
function generateOptimizationKey(start: string, end: string, stops: string[]): string {
	// Sort stops to ensure A,B,C generates same key as C,B,A if the set is the same
	// (Though technically order matters for the INPUT, usually we want to cache the RESULT for this specific request)
	// Actually, for optimization, the input order matters less than the SET of addresses.
	// However, to be safe, let's hash the specific input request.
	const combined = [start, end, ...stops]
		.filter(Boolean)
		.join('|')
		.toLowerCase()
		.replace(/[^a-z0-9|]/g, '');
	// Simple hash to keep key short
	let hash = 0;
	for (let i = 0; i < combined.length; i++) {
		const char = combined.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return `opt:${hash}`;
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security Check
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// [!code fix] SECURITY: Rate limit expensive route optimization (10/min per user)
	const sessionsKV = safeKV(platform?.env, 'BETA_SESSIONS_KV');
	if (sessionsKV) {
		const identifier = getClientIdentifier(request, locals);
		const rateLimitResult = await checkRateLimitEnhanced(
			sessionsKV,
			identifier,
			'directions_optimize',
			10, // 10 requests per minute (expensive operation)
			60000
		);

		const headers = createRateLimitHeaders(rateLimitResult);

		if (!rateLimitResult.allowed) {
			log.warn('[DirectionsOptimize] Rate limit exceeded', { identifier });
			return json(
				{
					error: 'Too many optimization requests. Please try again later.',
					resetAt: rateLimitResult.resetAt
				},
				{ status: 429, headers }
			);
		}
	}

	const __body: any = await request.json();
	const { startAddress, endAddress, stops } = __body;

	if (!startAddress || !stops || stops.length < 2) {
		return json({ error: 'Not enough data to optimize' }, { status: 400 });
	}

	const kv = (platform?.env as any)?.BETA_DIRECTIONS_KV as KVNamespace;
	const apiKey = (platform?.env as any)?.PRIVATE_GOOGLE_MAPS_API_KEY;
	const cacheKey = generateOptimizationKey(
		startAddress,
		endAddress || '',
		stops.map((s: any) => s.address)
	);

	// 3. Check KV Cache
	if (kv) {
		const cached = await kv.get(cacheKey);
		if (cached) {
			return json(JSON.parse(cached));
		}
	}

	// Prepare Addresses
	const stopAddresses = stops.map((s: any) => s.address);
	const allAddresses = [startAddress, ...stopAddresses];
	if (endAddress) allAddresses.push(endAddress);

	// 4. OSRM removed: Use Google Directions 'optimize:true' (Server-side) with KV caching.
	// The Google fallback below handles optimization and caching.

	// 5. Google Fallback (Server-Side)
	if (!apiKey) {
		return json({ error: 'Optimization service unavailable' }, { status: 500 });
	}

	try {
		const origin = startAddress;
		let destination = endAddress;
		// Make a copy of stops to modify if needed
		const waypointsList = [...stopAddresses];

		// Google requires a destination. If none provided, the last stop becomes the destination.
		// We replicate the logic used in the client: pop the last stop.
		if (!destination && waypointsList.length > 0) {
			destination = waypointsList.pop();
		}

		const waypointsStr = waypointsList.map((w: string) => encodeURIComponent(w)).join('|');
		const gUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=optimize:true|${waypointsStr}&key=${apiKey}`;

		const gRes = await fetch(gUrl);
		const gData: any = await gRes.json();

		if (gData.status === 'OK' && gData.routes && gData.routes.length > 0) {
			const route = gData.routes[0];
			const result = {
				source: 'google',
				optimizedOrder: route.waypoint_order,
				legs: route.legs // Include legs for distance calculations
			};

			if (kv) await kv.put(cacheKey, JSON.stringify(result));
			return json(result);
		}

		return json({ error: gData.status }, { status: 400 });
	} catch (e) {
		log.error('Google Optimization Error', { message: (e as any)?.message });
		return json({ error: 'Optimization failed' }, { status: 500 });
	}
};
