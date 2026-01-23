import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ platform }) => {
	const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace | undefined;

	if (!placesKV) return json({ error: 'No KV Binding' });

	try {
		const list = await placesKV.list({ limit: 5 });
		const sampleValues = [];

		// Fetch the actual JSON content for the first 3 items
		for (const key of list.keys.slice(0, 3)) {
			const val = await placesKV.get(key.name);
			sampleValues.push({
				key: key.name,
				value_raw: val, // Show exact string stored
				is_valid_json: isValidJson(val)
			});
		}

		return json({
			status: 'Connected',
			total_count: list.keys.length,
			samples: sampleValues
		});
	} catch (e) {
		return json({ error: String(e) });
	}
};

function isValidJson(str: string | null) {
	try {
		JSON.parse(str || '');
		return true;
	} catch {
		return false;
	}
}
