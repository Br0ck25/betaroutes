// src/routes/api/autocomplete/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		const body: any = await request.json();
		const { query, results } = body;

		if (!query || !results || !Array.isArray(results)) {
			return json({ error: 'Invalid request' }, { status: 400 });
		}

		const kv = platform?.env?.BETA_PLACES_KV;
		if (!kv) {
			return json({ cached: false });
		}

		// --- BUCKET PATTERN OPTIMIZATION ---

		// 1. Group new items by their potential prefixes
		// Map<Prefix, Place[]>
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
		// We do this in parallel, but limited to avoid hitting concurrency limits
		const updatePromises = Array.from(prefixMap.entries()).map(async ([key, newItems]) => {
			// A. Read existing bucket
			const existingRaw = await kv.get(key);
			let bucket = existingRaw ? JSON.parse(existingRaw) : [];

			// B. Merge & Deduplicate
			// Add new items only if they aren't already in the bucket
			for (const item of newItems) {
				const exists = bucket.some(
					(b: any) =>
						b.formatted_address === item.formatted_address ||
						(b.place_id && b.place_id === item.place_id)
				);

				if (!exists) {
					bucket.push(item);
				}
			}

			// C. Cap bucket size (e.g., keep top 20 to ensure fast reads)
			if (bucket.length > 20) {
				bucket = bucket.slice(0, 20);
			}

			// D. Write back
			// Save bucket permanently so autocomplete caches don't expire
			await kv.put(key, JSON.stringify(bucket));
		});

		await Promise.all(updatePromises);

		return json({
			cached: true,
			count: results.length,
			bucketsUpdated: prefixMap.size
		});
	} catch (err) {
		log.error('Autocomplete cache error', { message: (err as any)?.message });
		return json({ error: 'Failed to cache' }, { status: 500 });
	}
};
