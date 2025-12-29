import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import { generatePlaceKey } from '$lib/utils/keys';
import { sanitizeString } from '$lib/server/sanitize';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Security: Block unauthenticated writes
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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
			contributedBy: (locals.user as any).id
		};

		const keyText = place.formatted_address || place.name;

		// 1. Save "Detail" Record (place:<hash>)
		// This is used if we ever need to look up a specific place ID directly
		const key = await generatePlaceKey(keyText);
		await placesKV.put(key, JSON.stringify(place), { expirationTtl: 5184000 }); // 60 days

		// 2. [!code ++] Update Search Index Buckets (prefix:...)
		// This ensures the place shows up in future autocomplete searches
		const normalized = keyText.toLowerCase().replace(/\s+/g, '');

		// We update specific prefixes to ensure it appears as the user types
		// Limiting concurrency to avoid overwhelming the worker
		const prefixesToUpdate = [];
		for (let len = 2; len <= Math.min(10, normalized.length); len++) {
			prefixesToUpdate.push(normalized.substring(0, len));
		}

		// Process bucket updates in parallel
		await Promise.all(
			prefixesToUpdate.map(async (prefix) => {
				const bucketKey = `prefix:${prefix}`;
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

				await placesKV.put(bucketKey, JSON.stringify(bucket), { expirationTtl: 5184000 });
			})
		);

		return json({ success: true });
	} catch (e) {
		log.error('Cache Error', { message: (e as any)?.message });
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};
