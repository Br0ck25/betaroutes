import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ platform }) => {
	const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace | undefined;
	if (!placesKV) return json({ error: 'No KV' });

	try {
		// 1. Get all existing keys
		const list = await placesKV.list();
		let created = 0;

		for (const key of list.keys) {
			const originalKey = key.name;
			const rawData = await placesKV.get(originalKey);
			if (!rawData) continue;

			// 2. Split address into searchable parts
			// e.g. "101 buzzard rock" -> ["101", "buzzard", "rock"]
			const parts = originalKey.split(/[\s,]+/);

			// 3. Save a pointer for each significant part
			// We skip short words like "rd", "st", "ky" to save space if needed,
			// but for now let's just index words > 2 chars or numbers
			for (let i = 0; i < parts.length; i++) {
				const word = (parts[i] || '').toLowerCase();
				if (word.length < 2) continue;

				// Create a "Search Key" that points to the data
				// Format: "buzzard|101 buzzard rock..."
				// We use the pipe | to separate the search term from the full ID
				// BUT KV lists are sorted.
				// Better strategy: Store the data at "buzzard rock 101..."?
				// No, simpler: Just save the data again at "buzzard rock..."

				// Construct a suffix key: "buzzard rock, isom, ky..."
				const suffixKey = parts.slice(i).join(' ');

				// Don't overwrite the original if it matches
				if (suffixKey !== originalKey) {
					await placesKV.put(suffixKey, rawData);
					created++;
				}
			}
		}

		return json({
			success: true,
			message: `Migration complete.`,
			keys_scanned: list.keys.length,
			new_search_keys_created: created
		});
	} catch (e) {
		return json({ error: String(e) });
	}
};
