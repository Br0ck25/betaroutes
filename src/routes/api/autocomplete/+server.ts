// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
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

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null;
}

function hasGet(v: unknown): v is { get: (k: string, type?: 'json' | 'text') => Promise<unknown> } {
	return isRecord(v) && typeof (v as Record<string, unknown>)['get'] === 'function';
}

function isCachedPlace(
	obj: unknown
): obj is { formatted_address?: string; name?: string; place_id?: string; osm_value?: string } {
	if (!isRecord(obj)) return false;
	const fa = obj['formatted_address'];
	const name = obj['name'];
	return (typeof fa === 'string' && fa.length > 0) || (typeof name === 'string' && name.length > 0);
}

function isPlaceDetails(obj: unknown): obj is {
	geometry?: { location?: { lat?: unknown; lng?: unknown } };
	formatted_address?: string;
	name?: string;
} {
	if (!isRecord(obj)) return false;
	if (!isRecord(obj['geometry'])) return false;
	if (!isRecord((obj['geometry'] as Record<string, unknown>)['location'])) return false;
	const loc = (obj['geometry'] as Record<string, unknown>)['location'] as Record<string, unknown>;
	return typeof loc['lat'] === 'number' && typeof loc['lng'] === 'number';
}

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
			const data = (await res.json()) as unknown;
			if (
				isRecord(data) &&
				data['status'] === 'OK' &&
				isRecord(data['result']) &&
				isPlaceDetails(data['result'])
			) {
				const result = data['result'] as Record<string, unknown>;
				// Background: cache geocode directly to BETA_PLACES_KV for reuse (bypass PlacesIndexDO)
				try {
					const { getEnv, safeKV } = await import('$lib/server/env');
					const env = getEnv(platform);
					const placesKV = safeKV(env, 'BETA_PLACES_KV') as KVNamespace | undefined;
					if (
						placesKV &&
						result &&
						isRecord(result['geometry']) &&
						isRecord((result['geometry'] as Record<string, unknown>)['location'])
					) {
						const addr =
							typeof result['formatted_address'] === 'string'
								? result['formatted_address']
								: typeof result['name'] === 'string'
									? result['name']
									: undefined;
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
										const loc = (result['geometry'] as Record<string, unknown>)[
											'location'
										] as Record<string, unknown>;
										await placesKV.put(
											geoKey,
											JSON.stringify({
												lat: Number(loc['lat']),
												lon: Number(loc['lng']),
												formattedAddress:
													typeof result['formatted_address'] === 'string'
														? result['formatted_address']
														: addr,
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

				return json(result);
			}
			return json(
				{
					error:
						isRecord(data) && typeof data['status'] === 'string' ? data['status'] : 'Bad response'
				},
				{ status: 400 }
			);
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

	// SECURITY (Issue #8): Use user-scoped bucket key if authenticated

	const userId =
		isRecord(locals.user) && typeof locals.user['id'] === 'string' ? locals.user['id'] : null;
	const bucketKey = userId ? `user:${userId}:prefix:${searchPrefix}` : null;

	try {
		// 1. Try KV Cache First (Skip if forceGoogle is true)
		// Only check cache if user is authenticated (prevents poisoned global data exposure)
		if (kv && !forceGoogle && bucketKey && hasGet(kv)) {
			const bucketRaw = await kv.get(bucketKey);
			if (typeof bucketRaw === 'string') {
				let parsed: unknown;
				try {
					parsed = JSON.parse(bucketRaw);
				} catch {
					parsed = undefined;
				}

				if (Array.isArray(parsed)) {
					const bucket = parsed as unknown[];

					const matches = bucket
						.filter((item) => isCachedPlace(item))
						.filter((item) => {
							const str = (item.formatted_address || item.name || '').toLowerCase();
							return str.includes(query.toLowerCase());
						});
					if (matches.length > 0) {
						// STRICT CACHE VALIDATION
						const trimmedQuery = query.trim();
						const addressMatch = trimmedQuery.match(/^(\d+)\s+([a-zA-Z0-9]+)/);
						const looksLikeSpecificAddress = !!addressMatch;
						const streetToken =
							addressMatch && addressMatch[2] ? addressMatch[2].toLowerCase() : undefined;
						const broadTypes = [
							'city',
							'state',
							'country',
							'county',
							'state_district',
							'place',
							'administrative'
						];

						const filteredMatches = matches.filter((it) => {
							const text = (it.formatted_address || it.name || '').toLowerCase();
							if ((it.name || '').trim().match(/^\d+\s*$/)) return false;
							if (it.osm_value && broadTypes.includes(it.osm_value)) return false;

							if (looksLikeSpecificAddress) {
								const addrNum = addressMatch && addressMatch[1] ? addressMatch[1] : undefined;
								if (!addrNum || !text.includes(addrNum)) return false;
								const token = streetToken;
								if (token && !text.includes(token)) return false;
							}
							return true;
						});

						if (filteredMatches.length > 0) return json(filteredMatches);
					}
				}
			}
		}
		const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode&components=country:us`;
		const response = await fetch(googleUrl);
		const data = (await response.json()) as unknown;

		if (isRecord(data) && data['status'] === 'OK' && Array.isArray(data['predictions'])) {
			const results = (data['predictions'] as unknown[]).map((p) => {
				const pred = isRecord(p) ? (p as Record<string, unknown>) : {};
				const structured = isRecord(pred['structured_formatting'])
					? (pred['structured_formatting'] as Record<string, unknown>)
					: {};
				return {
					formatted_address: typeof pred['description'] === 'string' ? pred['description'] : '',
					name:
						typeof structured['main_text'] === 'string'
							? structured['main_text']
							: typeof pred['description'] === 'string'
								? pred['description']
								: '',
					secondary_text:
						typeof structured['secondary_text'] === 'string'
							? structured['secondary_text']
							: undefined,
					place_id: typeof pred['place_id'] === 'string' ? pred['place_id'] : undefined,
					source: 'google_proxy'
				};
			});
			// Save Google results to KV with Fan-Out (Background)
			// SECURITY (Issue #8): Only cache if user is authenticated (user-scoped)
			if (kv && results.length > 0 && userId) {
				const cacheTask = fanOutCache(kv, results, userId);
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
		log.error('Autocomplete Error', { message: (err as Error)?.message });
		return json([]);
	}
};

/**
 * Helper: Fan-out Cache Logic
 * Caches results into multiple user-scoped prefix buckets (2..10 chars)
 * SECURITY (Issue #8): Now requires userId for per-user cache isolation
 */

async function fanOutCache(
	kv: KVNamespace,
	results: Array<{ formatted_address?: string; name?: string; place_id?: string }>,
	userId: string
) {
	// 1. Group new items by their potential prefixes

	const prefixMap = new Map<string, unknown[]>();

	for (const result of results) {
		const address = result.formatted_address || result.name || '';
		const normalized = address.toLowerCase().replace(/\s+/g, '');

		// Generate prefixes for this result (lengths 2 to 10)
		for (let len = 2; len <= Math.min(10, normalized.length); len++) {
			const prefix = normalized.substring(0, len);
			// SECURITY: Use user-scoped key to prevent cache poisoning
			const key = `user:${userId}:prefix:${prefix}`;

			if (!prefixMap.has(key)) {
				prefixMap.set(key, []);
			}
			prefixMap.get(key)!.push(result);
		}
	}

	// 2. Process each prefix bucket (user-scoped)
	const updatePromises = Array.from(prefixMap.entries()).map(async ([key, newItems]) => {
		const existingRaw = await kv.get(key);
		let bucket = existingRaw ? JSON.parse(existingRaw) : [];

		for (const item of newItems) {
			if (!isCachedPlace(item)) continue;
			const exists = bucket.some(
				(b: unknown) =>
					isCachedPlace(b) &&
					(b.formatted_address === item.formatted_address ||
						(b.place_id && b.place_id === item.place_id))
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
		const rawPlace: unknown = await request.json();
		const placesKV = safeKV(env, 'BETA_PLACES_KV');

		if (!placesKV || !isRecord(rawPlace)) return json({ success: false });

		const place = {
			formatted_address: sanitizeString(
				typeof rawPlace['formatted_address'] === 'string' ? rawPlace['formatted_address'] : '',
				500
			),
			name: sanitizeString(typeof rawPlace['name'] === 'string' ? rawPlace['name'] : '', 200),
			secondary_text: sanitizeString(
				typeof rawPlace['secondary_text'] === 'string' ? rawPlace['secondary_text'] : '',
				300
			),
			place_id: sanitizeString(
				typeof rawPlace['place_id'] === 'string' ? rawPlace['place_id'] : '',
				200
			),
			geometry: isRecord(rawPlace['geometry']) ? rawPlace['geometry'] : undefined,
			source: sanitizeString(typeof rawPlace['source'] === 'string' ? rawPlace['source'] : '', 50)
		};

		const keyText = place.formatted_address || place.name;
		if (!keyText) return json({ success: false });
		const key = await generatePlaceKey(keyText);

		const userId =
			isRecord(locals.user) && typeof locals.user['id'] === 'string'
				? locals.user['id']
				: undefined;
		await (placesKV as KVNamespace).put(
			key,
			JSON.stringify({
				...place,
				cachedAt: new Date().toISOString(),
				source: 'autocomplete_selection',
				contributedBy: userId
			})
		);
		// Log the place key for debugging/verification
		log.info('[Autocomplete] Cached place detail', { key, keyText });

		// Also record this selection in PLACES KV (bypass PlacesIndexDO) — keep a per-user recent list (non-blocking)
		try {
			const contributorId =
				isRecord(locals.user) && typeof locals.user['id'] === 'string'
					? locals.user['id']
					: undefined;
			if (contributorId) {
				const recentKey = `recent:${contributorId}`;
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
			}
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
