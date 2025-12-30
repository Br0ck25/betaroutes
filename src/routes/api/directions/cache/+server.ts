// src/routes/api/directions/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

/**
 * Helper to geocode address to [lon, lat] using Photon
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

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	// 1. Security: Ensure user is logged in
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');

	if (!start || !end) {
		return json({ error: 'Missing start or end address' }, { status: 400 });
	}

	const apiKey = (platform?.env as any)?.PRIVATE_GOOGLE_MAPS_API_KEY;

	// 2. Try OSRM (Free)
	// Requires Geocoding first (Address -> Coords)
	try {
		const startCoords = await geocodePhoton(start, apiKey);
		const endCoords = await geocodePhoton(end, apiKey);

		if (startCoords && endCoords) {
			// OSRM expects: lon,lat;lon,lat
			const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startCoords.join(',')};${endCoords.join(',')}?overview=false`;

			const res = await fetch(osrmUrl);
			const data: any = await res.json();

			if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
				const route = data.routes[0];
				const result = {
					distance: route.distance, // meters
					duration: route.duration // seconds
				};

				return json({ source: 'osrm', data: result });
			}
		}
	} catch (e) {
		log.warn('OSRM/Photon routing failed, falling back to Google', {
			message: (e as any)?.message
		});
	}

	// 3. Fallback: Call Google Directions API (Server-Side)
	if (!apiKey) {
		log.error('PRIVATE_GOOGLE_MAPS_API_KEY is missing');
		return json({ error: 'Server configuration error' }, { status: 500 });
	}

	try {
		log.info('Fetching route from Google', { start, end });
		const googleUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(end)}&key=${apiKey}`;

		const response = await fetch(googleUrl);
		const data: any = await response.json();

		if (data.status === 'OK' && data.routes?.[0]?.legs?.[0]) {
			const leg = data.routes[0].legs[0];

			const result = {
				distance: leg.distance.value,
				duration: leg.duration.value
			};

			return json({ source: 'google', data: result });
		}

		return json({ error: 'Route not found', details: data.status }, { status: 404 });
	} catch (e) {
		log.error('Directions proxy error', { message: (e as any)?.message });
		return json({ error: 'Failed to calculate route' }, { status: 500 });
	}
};
