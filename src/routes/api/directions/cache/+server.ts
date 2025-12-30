// src/routes/api/directions/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

import { geocodePhoton } from '$lib/server/geocode';

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
