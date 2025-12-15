// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import { generatePlaceKey } from '$lib/utils/keys';

/**
 * GET Handler
 * Mode A: ?placeid=... -> Returns Google Place Details (Lat/Lng)
 * Mode B: ?q=...       -> Returns Autocomplete Suggestions (Cache -> Google)
 */
export const GET: RequestHandler = async ({ url, platform }) => {
	const query = url.searchParams.get('q');
	const placeId = url.searchParams.get('placeid');
	
	// Use the PRIVATE key for server-side calls to prevent leaking it
	const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;

	// --- MODE A: PLACE DETAILS (Get Lat/Lng) ---
	if (placeId) {
		if (!apiKey) return json({ error: 'Server key missing' }, { status: 500 });

		try {
			const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,name,formatted_address&key=${apiKey}`;
			const res = await fetch(detailsUrl);
			const data = await res.json();

			if (data.status === 'OK' && data.result) {
				return json(data.result);
			}
			return json({ error: data.status }, { status: 400 });
		} catch (e) {
			return json({ error: 'Failed to fetch details' }, { status: 500 });
		}
	}

	// --- MODE B: AUTOCOMPLETE SEARCH ---
	if (!query || query.length < 2) {
		return json([]);
	}

	try {
		const kv = platform?.env?.BETA_PLACES_KV;
		
		// 1. Try KV Cache First (Free)
		if (kv) {
			const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
			const searchPrefix = normalizedQuery.substring(0, 10);
			
			const bucketKey = `prefix:${searchPrefix}`;
			const bucketRaw = await kv.get(bucketKey);

			if (bucketRaw) {
				const bucket = JSON.parse(bucketRaw);
				const matches = bucket.filter((item: any) => {
					const str = (item.formatted_address || item.name || '').toLowerCase();
					return str.includes(query.toLowerCase());
				});
				
				if (matches.length > 0) {
					return json(matches);
				}
			}
		}

		// 2. Google Fallback (Cost: $2.83/1000 reqs)
		if (!apiKey) {
			// Cannot fallback to Google without the private key
			return json([]);
		}

		const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode&components=country:us`;
		
		const response = await fetch(googleUrl);
		const data = await response.json();

		if (data.status === 'OK' && data.predictions) {
			const results = data.predictions.map((p: any) => ({
				formatted_address: p.description,
				name: p.structured_formatting?.main_text || p.description,
				secondary_text: p.structured_formatting?.secondary_text,
				place_id: p.place_id,
				source: 'google_proxy'
			}));
			return json(results);
		}

		return json([]);

	} catch (err) {
		console.error('Autocomplete Error:', err);
		return json([]);
	}
};

/**
 * POST Handler
 * Caches a user selection to the KV store to save money on future searches.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security: Block unauthenticated writes
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const place = await request.json();
		const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

		if (!placesKV) {
			console.warn('BETA_PLACES_KV not found for caching');
			return json({ success: false });
		}

		if (!place || (!place.formatted_address && !place.name)) {
			return json({ success: false, error: 'Invalid data' });
		}

		const keyText = place.formatted_address || place.name;
		
		// [!code fix] Use Hashed Key to prevent 512-byte limit errors
		const key = await generatePlaceKey(keyText);

		// Save to KV with TTL (60 days)
		await placesKV.put(key, JSON.stringify({
			...place,
			cachedAt: new Date().toISOString(),
			source: 'autocomplete_selection',
			contributedBy: locals.user.id
		}), { expirationTtl: 5184000 });

		return json({ success: true });

	} catch (e) {
		console.error('Cache Error:', e);
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};