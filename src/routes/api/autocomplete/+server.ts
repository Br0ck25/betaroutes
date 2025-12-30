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
import { log } from '$lib/server/log';

/**
 * GET Handler
 * Mode A: ?placeid=... -> Returns Google Place Details (Lat/Lng)
 * Mode B: ?q=...       -> Returns Autocomplete Suggestions (KV -> Photon -> Google)
 * * Supports 'forceGoogle=true' to bypass OSRM/Cache if client rejected previous results.
 */
export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
	const { getEnv, safeKV } = await import('$lib/server/env');
	const env = getEnv(platform);
	const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
	if (sessionsKV) {
		const identifier = getClientIdentifier(request, locals);
		const authenticated = isAuthenticated(locals);
		const config = authenticated ? RATE_LIMITS.AUTOCOMPLETE_AUTH : RATE_LIMITS.AUTOCOMPLETE_ANON;

		const rateLimitResult = await checkRateLimitEnhanced(
			sessionsKV,
			identifier,
			'autocomplete',
			config.limit,
			config.windowMs
		);

		const headers = createRateLimitHeaders(rateLimitResult);

		if (!rateLimitResult.allowed) {
			return json(
				{
					error: 'Too many requests. Please try again later.',
					limit: rateLimitResult.limit,
					resetAt: rateLimitResult.resetAt
				},
				{ status: 429, headers }
			);
		}
	}

	const query = sanitizeQueryParam(url.searchParams.get('q'), 200);
	const placeId = sanitizeQueryParam(url.searchParams.get('placeid'), 200);
	// [!code ++] Allow client to force Google escalation
	const forceGoogle = url.searchParams.get('forceGoogle') === 'true';

	const apiKey = env['PRIVATE_GOOGLE_MAPS_API_KEY'];

	// --- MODE A: PLACE DETAILS ---
	if (placeId) {
		if (!apiKey) return json({ error: 'Server key missing' }, { status: 500 });
		try {
			const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,name,formatted_address&key=${apiKey}`;
			const res = await fetch(detailsUrl);
			const data: any = await res.json();
			if (data.status === 'OK' && data.result) return json(data.result);
			return json({ error: data.status }, { status: 400 });
		} catch (err: unknown) {
			void err;
			return json({ error: 'Failed to fetch details' }, { status: 500 });
		}
	}

	// --- MODE B: AUTOCOMPLETE SEARCH ---
	if (!query || query.length < 2) return json([]);

	const kv = platform?.env?.BETA_PLACES_KV;
	const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
	const searchPrefix = normalizedQuery.substring(0, 10);
	const bucketKey = `prefix:${searchPrefix}`;

	try {
		// 1. Try KV Cache First (Skip if forceGoogle is true)
		// [!code ++] Added !forceGoogle check
		if (kv && !forceGoogle) {
			const bucketRaw = await kv.get(bucketKey);
			if (bucketRaw) {
				const bucket = JSON.parse(bucketRaw);
				const matches = bucket.filter((item: any) => {
					const str = (item.formatted_address || item.name || '').toLowerCase();
					return str.includes(query.toLowerCase());
				});
				if (matches.length > 0) {
					// STRICT CACHE VALIDATION
					// Ensure we don't return cached garbage (e.g. "Louisville" for "407 Mastin")
					const trimmedQuery = query.trim();
					const addressMatch = trimmedQuery.match(/^(\d+)\s+([a-zA-Z0-9]+)/);
					const looksLikeSpecificAddress = !!addressMatch;
					const streetToken =
						addressMatch && addressMatch[2] ? addressMatch[2].toLowerCase() : null;
					const broadTypes = [
						'city',
						'state',
						'country',
						'county',
						'state_district',
						'place',
						'administrative'
					];

					const filteredMatches = matches.filter((it: any) => {
						const text = (it.formatted_address || it.name || '').toLowerCase();
						if ((it.name || '').trim().match(/^\d+\s*$/)) return false;
						if (it.osm_value && broadTypes.includes(it.osm_value)) return false;

						if (looksLikeSpecificAddress) {
							if (!text.includes(addressMatch![1])) return false;
							// If input is "407 Mastin", result MUST contain "mastin"
							if (streetToken && !text.includes(streetToken)) return false;
						}
						return true;
					});

					if (filteredMatches.length > 0) return json(filteredMatches);
				}
			}
		}

		// 2. Try Photon (OpenStreetMap) - Free (Skip if forceGoogle is true)
		// [!code ++] Added !forceGoogle check
		if (!forceGoogle) {
			try {
				// Limit to 5 results to keep parsing fast
				const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
				const pRes = await fetch(photonUrl);
				const pData: any = await pRes.json();
				if (pData.features && pData.features.length > 0) {
					const trimmedQuery = query.trim();
					const addressMatch = trimmedQuery.match(/^(\d+)\s+([a-zA-Z0-9]+)/);
					const looksLikeSpecificAddress = !!addressMatch;
					const streetToken =
						addressMatch && addressMatch[2] ? addressMatch[2].toLowerCase() : null;

					const validFeatures = pData.features.filter((f: any) => {
						const p = f.properties;

						// STRICT ADDRESS VALIDATION
						if (looksLikeSpecificAddress) {
							// 1. Must have a house number
							if (!p.housenumber) return false;

							// 2. Must have a street name
							const hasStreetName = p.street || p.name;
							if (!hasStreetName) return false;

							// 3. Token Check: If input is "407 Mastin", result MUST contain "mastin"
							if (streetToken) {
								const resultText = [p.name || '', p.street || ''].join(' ').toLowerCase();
								if (!resultText.includes(streetToken)) {
									return false;
								}
							}

							// 4. Reject broad types
							const broadTypes = ['city', 'state', 'country', 'county', 'state_district'];
							if (broadTypes.includes(p.osm_value) || broadTypes.includes(p.osm_key)) {
								return false;
							}
						}
						return true;
					});

					if (validFeatures.length > 0) {
						const results = validFeatures
							.map((f: any) => {
								const p = f.properties;
								const broadTypes = [
									'city',
									'state',
									'country',
									'county',
									'state_district',
									'place',
									'administrative'
								];
								if (broadTypes.includes(p.osm_value) || broadTypes.includes(p.osm_key))
									return false;
								if ((p.name || '').trim().match(/^\d+\s*$/)) return false;

								const parts = [p.name];
								if (p.housenumber && p.name !== p.housenumber) parts.unshift(p.housenumber);
								if (p.city && p.city !== p.name) parts.push(p.city);
								if (p.state && p.state !== p.city) parts.push(p.state);
								if (p.country && p.country !== p.state) parts.push(p.country);

								const formatted = Array.from(new Set(parts.filter(Boolean))).join(', ');

								return {
									formatted_address: formatted,
									name: p.name,
									secondary_text: [p.city, p.state, p.country].filter(Boolean).join(', '),
									place_id: `photon:${f.geometry.coordinates[1]},${f.geometry.coordinates[0]}`,
									geometry: {
										location: {
											lat: f.geometry.coordinates[1],
											lng: f.geometry.coordinates[0]
										}
									},
									source: 'photon',
									house_number: p.housenumber || null,
									street: p.street || p.name || null,
									osm_value: p.osm_value
								};
							})
							.filter(Boolean); // filter out false returns

						if (kv && results.length > 0) {
							await kv.put(bucketKey, JSON.stringify(results), { expirationTtl: 86400 });
						}

						if (results.length > 0) return json(results);
					} else {
						log.warn('Photon results rejected by validation', { query });
					}
				}
			} catch (photonErr) {
				log.warn('Photon lookup failed or rejected, falling back to Google', {
					message: (photonErr as any)?.message
				});
			}
		}

		// 3. Google Fallback (Cost: $) - Executed if:
		//    a) KV missed AND Photon failed/rejected
		//    b) OR forceGoogle=true
		if (!apiKey) return json([]);

		const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode&components=country:us`;
		const response = await fetch(googleUrl);
		const data: any = await response.json();

		if (data.status === 'OK' && data.predictions) {
			const results = data.predictions.map((p: any) => ({
				formatted_address: p.description,
				name: p.structured_formatting?.main_text || p.description,
				secondary_text: p.structured_formatting?.secondary_text,
				place_id: p.place_id,
				source: 'google_proxy'
			}));

			// Save Google results to KV to save money next time
			// We can cache these even if forced, as Google results are generally high quality
			if (kv && results.length > 0) {
				await kv.put(bucketKey, JSON.stringify(results), { expirationTtl: 86400 });
			}

			return json(results);
		}

		return json([]);
	} catch (err) {
		log.error('Autocomplete Error', { message: (err as any)?.message });
		return json([]);
	}
};

/**
 * POST Handler
 * Caches a user selection to the KV store.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { getEnv, safeKV } = await import('$lib/server/env');
	const env = getEnv(platform);
	const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
	if (sessionsKV) {
		const identifier = getClientIdentifier(request, locals);
		const rateLimitResult = await checkRateLimitEnhanced(
			sessionsKV,
			identifier,
			'autocomplete:write',
			30,
			60000
		);
		if (!rateLimitResult.allowed) {
			return json({ error: 'Too many cache writes.' }, { status: 429 });
		}
	}

	try {
		const rawPlace: any = await request.json();
		const placesKV = safeKV(env, 'BETA_PLACES_KV') as KVNamespace;

		if (!placesKV || !rawPlace) return json({ success: false });

		const place = {
			formatted_address: sanitizeString(rawPlace.formatted_address, 500),
			name: sanitizeString(rawPlace.name, 200),
			secondary_text: sanitizeString(rawPlace.secondary_text, 300),
			place_id: sanitizeString(rawPlace.place_id, 200),
			geometry: rawPlace.geometry,
			source: sanitizeString(rawPlace.source, 50)
		};

		const keyText = place.formatted_address || place.name;
		const key = await generatePlaceKey(keyText);

		await placesKV.put(
			key,
			JSON.stringify({
				...place,
				cachedAt: new Date().toISOString(),
				source: 'autocomplete_selection',
				contributedBy: (locals.user as any).id
			}),
			{ expirationTtl: 5184000 }
		);

		return json({ success: true });
	} catch (e) {
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};
