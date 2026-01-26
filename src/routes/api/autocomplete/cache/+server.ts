// src/routes/api/autocomplete/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';
import { sanitizeString } from '$lib/server/sanitize';

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null;
}

function isCachedPlace(
	obj: unknown
): obj is { formatted_address?: string; name?: string; place_id?: string; osm_value?: string } {
	if (!isRecord(obj)) return false;
	const fa = obj['formatted_address'];
	const name = obj['name'];
	return (typeof fa === 'string' && fa.length > 0) || (typeof name === 'string' && name.length > 0);
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// SECURITY (Issue #8): Require authentication to prevent anonymous cache poisoning
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const userId =
		isRecord(locals.user) && typeof locals.user['id'] === 'string' ? locals.user['id'] : undefined;
	if (!userId) {
		return json({ error: 'Invalid session' }, { status: 401 });
	}

	try {
		const body: unknown = await request.json();
		if (!isRecord(body)) return json({ error: 'Invalid request' }, { status: 400 });
		const rawQuery = typeof body['query'] === 'string' ? body['query'] : '';
		const resultsRaw = Array.isArray(body['results']) ? body['results'] : [];
		const query = sanitizeString(rawQuery, 200);
		const results = resultsRaw.slice(0, 50); // cap to 50 items to avoid abuse

		if (!query || results.length === 0) {
			return json({ error: 'Invalid request' }, { status: 400 });
		}

		const kv = platform?.env?.BETA_PLACES_KV;
		if (!kv) {
			return json({ cached: false });
		}

		// --- BUCKET PATTERN OPTIMIZATION ---

		// 1. Group new items by their potential prefixes
		// Map<Prefix, Place[]>

		const prefixMap = new Map<string, unknown[]>();

		for (const result of results) {
			if (!isCachedPlace(result)) continue;
			const address = sanitizeString(
				typeof (result as Record<string, unknown>)['formatted_address'] === 'string'
					? (result as Record<string, unknown>)['formatted_address']
					: typeof (result as Record<string, unknown>)['name'] === 'string'
						? (result as Record<string, unknown>)['name']
						: '',
				500
			);
			const normalized = address.toLowerCase().replace(/\s+/g, '');
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
			// A. Read existing bucket
			const existingRaw = await kv.get(key);
			let bucket: unknown[] = [];
			if (typeof existingRaw === 'string') {
				try {
					const parsed = JSON.parse(existingRaw);
					if (Array.isArray(parsed)) bucket = parsed;
				} catch {
					// ignore corrupt
				}
			}

			// B. Merge & Deduplicate
			for (const item of newItems) {
				if (!isCachedPlace(item)) continue;
				const exists = bucket.some(
					(b) =>
						isCachedPlace(b) &&
						(b.formatted_address === item.formatted_address ||
							(b.place_id && item.place_id && b.place_id === item.place_id))
				);
				if (!exists) {
					bucket.push(item);
				}
				bucket = bucket.slice(0, 20);
			}

			// D. Write back (user-scoped)
			await kv.put(key, JSON.stringify(bucket));
		});

		await Promise.all(updatePromises);

		return json({
			cached: true,
			count: results.length,
			bucketsUpdated: prefixMap.size
		});
	} catch (err) {
		log.error('Autocomplete cache error', { message: (err as Error)?.message });
		return json({ error: 'Failed to cache' }, { status: 500 });
	}
};
