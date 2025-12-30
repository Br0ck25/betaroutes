// src/routes/api/directions/optimize/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';
import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * Helper: Geocode using Photon (OpenStreetMap)
 * Returns [lon, lat]
 */
export async function geocodePhoton(address: string, apiKey?: string): Promise<[number, number] | null> {
	try {
		const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`;
		const res = await fetch(url);
		const data: any = await res.json();
		if (data.features && data.features.length > 0) {
			const f = data.features[0];
			const p = f.properties || {};

			// If input looks like a house-level address, require housenumber + street match
			const inputIsAddress = /^\d+\s+\w+/.test(address);
			if (inputIsAddress) {
				const hasHN = !!p.housenumber;
				const hasStreet = !!(p.street || p.name);
				const inputNumber = address.match(/^(\d+)/)?.[1] || null;
				const streetToken = address.match(/^\d+\s+(.+)$/)?.[1]?.split(/\s+/)[0]?.toLowerCase();
				const resultText = ((p.name || '') + ' ' + (p.street || '')).toLowerCase();

				// Require both housenumber equality and street presence/match
				if (!hasHN || String(p.housenumber) !== String(inputNumber) || !hasStreet || (streetToken && streetToken.length > 3 && !resultText.includes(streetToken))) {
					// Attempt Google fallback if API key provided
					if (apiKey) {
						try {
							const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
							const gRes = await fetch(gUrl);
							const gData: any = await gRes.json();
							if (gData.status === 'OK' && gData.results && gData.results.length > 0) {
								const loc = gData.results[0].geometry.location;
								return [loc.lng, loc.lat];
							}
						} catch (e) {
							log.warn('Google geocode failed (photon fallback)', { message: (e as any)?.message });
						}
					}
					return null;
				}
			}

			return f.geometry.coordinates as [number, number];
		}
	} catch (e) {
		log.warn('Photon geocode failed', { message: (e as any)?.message });
	}

	// Final attempt: try Google if key available
	if (apiKey) {
		try {
			const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
			const gRes = await fetch(gUrl);
			const gData: any = await gRes.json();
			if (gData.status === 'OK' && gData.results && gData.results.length > 0) {
				const loc = gData.results[0].geometry.location;
				return [loc.lng, loc.lat];
			}
		} catch (e) {
			log.warn('Google geocode failed (final fallback)', { message: (e as any)?.message });
		}
	}

	return null;
}

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

	// 4. Try OSRM (Free)
	try {
		// Geocode all points first
		const coords = await Promise.all(allAddresses.map((addr) => geocodePhoton(addr, apiKey)));
		const hasAllCoords = coords.every((c) => c !== null);

		if (hasAllCoords) {
			// OSRM Trip API: http://project-osrm.org/docs/v5.5.1/api/#trip-service
			const coordsString = coords.map((c) => c!.join(',')).join(';');
			let osrmUrl = `http://router.project-osrm.org/trip/v1/driving/${coordsString}?source=first`;

			if (endAddress) {
				osrmUrl += `&destination=last&roundtrip=false`;
			} else {
				// If no end address, we don't force roundtrip, allowing it to end at the best location?
				// Or we treat it as a roundtrip to start?
				// Google "optimizeWaypoints" usually keeps start/end fixed.
				// If no end provided, usually implies roundtrip or just visit all.
				// Let's assume roundtrip=false to be safe for a delivery route list.
				osrmUrl += `&roundtrip=false`;
			}

			const res = await fetch(osrmUrl);
			const data: any = await res.json();

			if (data.code === 'Ok' && data.waypoints) {
				// OSRM returns 'waypoints' sorted by their order in the Optimized Trip.
				// Each waypoint object has a 'waypoint_index' property corresponding to the Input Index.
				// Input Index 0 is Start.

				// We need to extract the indices of the "Stops" (which were input indices 1 to N).
				const waypointIndices = data.waypoints
					.map((wp: any) => wp.waypoint_index)
					.filter((idx: number) => {
						// Exclude Start (0)
						if (idx === 0) return false;
						// Exclude End (last index) if endAddress existed
						if (endAddress && idx === allAddresses.length - 1) return false;
						return true;
					});

				// Convert back to 0-based indices relative to the 'stops' array
				// The input index 1 corresponds to stops[0].
				const optimizedOrder = waypointIndices.map((idx: number) => idx - 1);

				const result = { source: 'osrm', optimizedOrder };

				if (kv) await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 }); // 24h cache
				return json(result);
			}
		}
	} catch (e) {
		log.warn('OSRM Optimization failed, falling back to Google', { message: (e as any)?.message });
	}

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

			if (kv) await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
			return json(result);
		}

		return json({ error: gData.status }, { status: 400 });
	} catch (e) {
		log.error('Google Optimization Error', { message: (e as any)?.message });
		return json({ error: 'Optimization failed' }, { status: 500 });
	}
};
