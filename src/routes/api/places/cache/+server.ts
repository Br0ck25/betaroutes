import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { generatePlaceKey } from '$lib/utils/keys';
import { sanitizeString } from '$lib/server/sanitize';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security: Block unauthenticated writes
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// SECURITY (Issue #8): Get user ID for per-user cache isolation

	const userId = (locals.user as any).id;
	if (!userId) {
		return json({ error: 'Invalid session' }, { status: 401 });
	}

	try {
		const rawPlace: any = await request.json();
		const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

		if (!placesKV) {
			log.warn('BETA_PLACES_KV not found for caching');
			return json({ success: false });
		}

		if (!rawPlace || (!rawPlace.formatted_address && !rawPlace.name)) {
			return json({ success: false, error: 'Invalid data' });
		}

		// Sanitize data
		const place = {
			formatted_address: sanitizeString(rawPlace.formatted_address, 500),
			name: sanitizeString(rawPlace.name, 200),
			secondary_text: sanitizeString(rawPlace.secondary_text, 300),
			place_id: sanitizeString(rawPlace.place_id, 200),
			geometry: rawPlace.geometry,
			source: 'autocomplete_selection', // Force source to ensure it looks 'local'
			cachedAt: new Date().toISOString(),
			contributedBy: userId
		};

		const keyText = place.formatted_address || place.name;

		// 1. Save "Detail" Record (place:<userId>:<hash>)
		// SECURITY: Scope to user to prevent cache poisoning
		const key = await generatePlaceKey(keyText);
		const userScopedKey = `place:${userId}:${key.replace('place:', '')}`;
		await placesKV.put(userScopedKey, JSON.stringify(place));

		// 2. Update per-user Search Index Buckets (user:<userId>:prefix:...)
		// SECURITY (Issue #8): Scope buckets to user to prevent global cache poisoning
		const normalized = keyText.toLowerCase().replace(/\s+/g, '');

		// We update specific prefixes to ensure it appears as the user types
		// Limiting concurrency to avoid overwhelming the worker
		const prefixesToUpdate = [];
		for (let len = 2; len <= Math.min(10, normalized.length); len++) {
			prefixesToUpdate.push(normalized.substring(0, len));
		}

		// Process bucket updates in parallel (user-scoped)
		await Promise.all(
			prefixesToUpdate.map(async (prefix) => {
				// SECURITY: Prefix with userId to isolate user's autocomplete data
				const bucketKey = `user:${userId}:prefix:${prefix}`;
				const existingRaw = await placesKV.get(bucketKey);
				let bucket = existingRaw ? JSON.parse(existingRaw) : [];

				// Remove if exists (to update it), then add to top

				bucket = bucket.filter(
					(b: any) =>
						b.formatted_address !== place.formatted_address && b.place_id !== place.place_id
				);

				bucket.unshift(place); // Add to TOP of list since it was just selected

				// Cap bucket size
				if (bucket.length > 20) bucket = bucket.slice(0, 20);

				// Save prefix bucket (user-scoped)
				await placesKV.put(bucketKey, JSON.stringify(bucket));
			})
		);

		return json({ success: true });
	} catch (e) {
		log.error('Cache Error', { message: (e as Error)?.message });
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};
