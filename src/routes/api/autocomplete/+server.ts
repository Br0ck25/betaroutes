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
 * Mode B: ?q=...       -> Returns Autocomplete Suggestions (KV -> Google)
 * * Supports 'forceGoogle=true' to bypass KV and force a Google query if the client rejected previous results.
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
	// Allow client to force Google escalation
	const forceGoogle = url.searchParams.get('forceGoogle') === 'true';

	const apiKey = env['PRIVATE_GOOGLE_MAPS_API_KEY'];

	// --- MODE A: PLACE DETAILS ---
	if (placeId) {
		if (!apiKey) return json({ error: 'Server key missing' }, { status: 500 });
		try {
			const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,name,formatted_address&key=${apiKey}`;
			const res = await fetch(detailsUrl);
			const data: any = await res.json();
			if (data.status === 'OK' && data.result) {
				// Background: cache geocode directly to BETA_PLACES_KV for reuse (bypass PlacesIndexDO)
				try {
					const { getEnv, safeKV } = await import('$lib/server/env');
					const env = getEnv(platform);
					const placesKV = safeKV(env, 'BETA_PLACES_KV') as KVNamespace | undefined;
					if (placesKV && data.result && data.result.geometry && data.result.geometry.location) {
						const addr = data.result.formatted_address || data.result.name;
						if (addr) {
							const geoKey = `geo:${addr
								.toLowerCase()
								.trim()
								.replace(/[^a-z0-9]/g, '_')}`;
							// Fire-and-forget write to KV
							void (async () => {
								try {
									const existing = await placesKV.get(geoKey);
									if (!existing) {
										await placesKV.put(
											geoKey,
											JSON.stringify({
												lat: Number(data.result.geometry.location.lat),
												lon: Number(data.result.geometry.location.lng),
												formattedAddress: data.result.formatted_address || addr,
												source: 'autocomplete_place_details'
											})
										);
									}
								} catch {
									// ignore KV failures
								}
							})();
						}
					}
				} catch {
					// ignore
				}

				return json(data.result);
			}
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

		// 2. KV missed -> Direct Google fallback (Photon removed). If KV misses, query Google for autocomplete.
		// This keeps costs predictable while still benefiting from KV caching.

		// 3. Google Fallback (Cost: $) - Executed if:
		//    a) KV missed
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

			// [!code ++] Save Google results to KV with Fan-Out (Background)
			if (kv && results.length > 0) {
				const cacheTask = fanOutCache(kv, results);
				if (platform && platform.context && platform.context.waitUntil) {
					platform.context.waitUntil(cacheTask);
				} else {
					// Fire and forget in environments without waitUntil
					cacheTask.catch((err) =>
						log.error('Background cache failed', {
							message: (err as Error)?.message || String(err)
						})
					);
				}
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
 * Helper: Fan-out Cache Logic
 * Caches results into multiple prefix buckets (2..10 chars)
 */
async function fanOutCache(kv: any, results: any[]) {
	// 1. Group new items by their potential prefixes
	const prefixMap = new Map<string, any[]>();

	for (const result of results) {
		const address = result.formatted_address || result.name || '';
		const normalized = address.toLowerCase().replace(/\s+/g, '');

		// Generate prefixes for this result (lengths 2 to 10)
		for (let len = 2; len <= Math.min(10, normalized.length); len++) {
			const prefix = normalized.substring(0, len);
			const key = `prefix:${prefix}`;

			if (!prefixMap.has(key)) {
				prefixMap.set(key, []);
			}
			prefixMap.get(key)!.push(result);
		}
	}

	// 2. Process each prefix bucket
	const updatePromises = Array.from(prefixMap.entries()).map(async ([key, newItems]) => {
		const existingRaw = await kv.get(key);
		let bucket = existingRaw ? JSON.parse(existingRaw) : [];

		for (const item of newItems) {
			const exists = bucket.some(
				(b: any) =>
					b.formatted_address === item.formatted_address ||
					(b.place_id && b.place_id === item.place_id)
			);
			if (!exists) bucket.push(item);
		}

		if (bucket.length > 20) bucket = bucket.slice(0, 20);
		await kv.put(key, JSON.stringify(bucket));
		log.info('[Autocomplete] Updated prefix bucket', { key, size: bucket.length });
	});

	await Promise.all(updatePromises);
}

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
			})
		);
		// Log the place key for debugging/verification
		log.info('[Autocomplete] Cached place detail', { key, keyText });

		// Also record this selection in PLACES KV (bypass PlacesIndexDO) — keep a per-user recent list (non-blocking)
		try {
			const userId = (locals.user as any).id;
			const recentKey = `recent:${userId}`;
			void (async () => {
				try {
					const existingRaw = await placesKV.get(recentKey);
					let list: string[] = existingRaw ? JSON.parse(existingRaw) : [];
					// Ensure uniqueness and push most recent to the end
					list = list.filter((a) => a !== keyText);
					list.push(keyText);
					if (list.length > 50) list = list.slice(-50);
					await placesKV.put(recentKey, JSON.stringify(list));
				} catch (err) {
					log.warn('[Autocomplete] recent list KV write failed', err);
				}
			})();
		} catch (e) {
			// Don't block on failures
			log.warn('[Autocomplete] Failed to update recent list (KV)', {
				message: (e as Error).message
			});
		}

		return json({ success: true });
	} catch (e) {
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};
