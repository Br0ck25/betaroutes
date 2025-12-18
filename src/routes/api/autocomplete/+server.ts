// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import { generatePlaceKey } from '$lib/utils/keys';
import {
	checkRateLimitEnhanced,
	createRateLimitHeaders,
	getClientIdentifier,
	isAuthenticated,
	RATE_LIMITS
} from '$lib/server/rateLimit';
import { sanitizeQueryParam, sanitizeString } from '$lib/server/sanitize';

/**
 * GET Handler
 * Mode A: ?placeid=... -> Returns Google Place Details (Lat/Lng)
 * Mode B: ?q=...       -> Returns Autocomplete Suggestions (KV -> Photon -> Google)
 */
export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
	// ← NEW: Rate Limiting
	const sessionsKV = platform?.env?.BETA_SESSIONS_KV;
	if (sessionsKV) {
		const identifier = getClientIdentifier(request, locals);
		const authenticated = isAuthenticated(locals);

		// Use different limits for authenticated vs anonymous users
		const config = authenticated ? RATE_LIMITS.AUTOCOMPLETE_AUTH : RATE_LIMITS.AUTOCOMPLETE_ANON;

		const rateLimitResult = await checkRateLimitEnhanced(
			sessionsKV,
			identifier,
			'autocomplete',
			config.limit,
			config.windowMs
		);

		// Add rate limit headers to response
		const headers = createRateLimitHeaders(rateLimitResult);

		if (!rateLimitResult.allowed) {
			return json(
				{
					error: 'Too many requests. Please try again later.',
					limit: rateLimitResult.limit,
					resetAt: rateLimitResult.resetAt
				},
				{
					status: 429,
					headers
				}
			);
		}

		// If allowed, we'll add headers to successful response later
	}

	// ← NEW: Sanitize query parameters to prevent injection
	const query = sanitizeQueryParam(url.searchParams.get('q'), 200);
	const placeId = sanitizeQueryParam(url.searchParams.get('placeid'), 200);

	const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;

	// --- MODE A: PLACE DETAILS (Get Lat/Lng) ---
	// Kept primarily for Google Place IDs. 
	// (Photon results usually include lat/lon directly, bypassing this need)
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

	const kv = platform?.env?.BETA_PLACES_KV;
	// Normalize query for cache key
	const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
	const searchPrefix = normalizedQuery.substring(0, 10);
	const bucketKey = `prefix:${searchPrefix}`;

	try {
		// 1. Try KV Cache First
		if (kv) {
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

		// 2. Try Photon (OpenStreetMap) - Free
		try {
			// Limit to 5 results, prioritize US (using bias logic if needed, but Photon handles standard queries well)
			const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`; 
			const pRes = await fetch(photonUrl);
			const pData = await pRes.json();

			if (pData.features && pData.features.length > 0) {
				const results = pData.features.map((f: any) => {
					const p = f.properties;
					
					// Logic: Always start with name, append context only if not duplicate
					const parts = [p.name];
					
					// Add City (if not same as name)
					if (p.city && p.city !== p.name) parts.push(p.city);
					// Add State/Administrative (if not same as city or name)
					if (p.state && p.state !== p.city && p.state !== p.name) parts.push(p.state);
					// Add Country
					if (p.country && p.country !== p.state) parts.push(p.country);

					const formatted = parts.filter(Boolean).join(', ');

					return {
						formatted_address: formatted,
						name: p.name,
						secondary_text: [p.city, p.state, p.country].filter(Boolean).join(', '),
						// Use Lat,Lng as ID for Photon to avoid Mode A lookup if client supports it, 
						// or stick to a unique string
						place_id: `photon:${f.geometry.coordinates[1]},${f.geometry.coordinates[0]}`, 
						geometry: {
							location: {
								lat: f.geometry.coordinates[1],
								lng: f.geometry.coordinates[0]
							}
						},
						source: 'photon'
					};
				});

				// Save to KV
				if (kv && results.length > 0) {
					await kv.put(bucketKey, JSON.stringify(results), { expirationTtl: 86400 }); // Cache for 24h
				}

				return json(results);
			}
		} catch (photonErr) {
			console.warn('Photon lookup failed, falling back to Google', photonErr);
		}

		// 3. Google Fallback (Cost: $)
		if (!apiKey) {
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

			// Save to KV
			if (kv && results.length > 0) {
				await kv.put(bucketKey, JSON.stringify(results), { expirationTtl: 86400 });
			}

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
 * Caches a user selection to the KV store.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security: Block unauthenticated writes
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// ← NEW: Rate Limiting for cache writes
	const sessionsKV = platform?.env?.BETA_SESSIONS_KV;
	if (sessionsKV) {
		const identifier = getClientIdentifier(request, locals);

		// Stricter rate limit for POST (cache writes)
		const rateLimitResult = await checkRateLimitEnhanced(
			sessionsKV,
			identifier,
			'autocomplete:write',
			30, // 30 writes per minute
			60000
		);

		const headers = createRateLimitHeaders(rateLimitResult);

		if (!rateLimitResult.allowed) {
			return json(
				{
					error: 'Too many cache writes. Please slow down.',
					limit: rateLimitResult.limit,
					resetAt: rateLimitResult.resetAt
				},
				{
					status: 429,
					headers
				}
			);
		}
	}

	try {
		const rawPlace = await request.json();
		const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

		if (!placesKV) {
			console.warn('BETA_PLACES_KV not found for caching');
			return json({ success: false });
		}

		if (!rawPlace || (!rawPlace.formatted_address && !rawPlace.name)) {
			return json({ success: false, error: 'Invalid data' });
		}

		// ← NEW: Sanitize place data to prevent XSS
		const place = {
			formatted_address: sanitizeString(rawPlace.formatted_address, 500),
			name: sanitizeString(rawPlace.name, 200),
			secondary_text: sanitizeString(rawPlace.secondary_text, 300),
			place_id: sanitizeString(rawPlace.place_id, 200),
			geometry: rawPlace.geometry, // Keep geometry as-is (numbers)
			source: sanitizeString(rawPlace.source, 50)
		};

		const keyText = place.formatted_address || place.name;

		// Use Hashed Key
		const key = await generatePlaceKey(keyText);

		// Save to KV with TTL (60 days)
		await placesKV.put(
			key,
			JSON.stringify({
				...place,
				cachedAt: new Date().toISOString(),
				source: 'autocomplete_selection',
				contributedBy: locals.user.id
			}),
			{ expirationTtl: 5184000 }
		);

		return json({ success: true });
	} catch (e) {
		console.error('Cache Error:', e);
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};