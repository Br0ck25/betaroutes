// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ url, platform }) => {
	const query = url.searchParams.get('q')?.toLowerCase();
	// Reduce limit to 2 chars for easier testing
	if (!query || query.length < 2) return json([]);

	const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

	if (!placesKV) {
		console.warn('[API:Autocomplete:GET] ❌ BETA_PLACES_KV is NOT bound!');
		return json([]);
	}

	try {
		console.log(`[API:Autocomplete:GET] Searching for: "${query}"`);
		// List keys starting with the query (prefix search)
		const list = await placesKV.list({ prefix: query, limit: 5 });
		console.log(`[API:Autocomplete:GET] Found ${list.keys.length} matches`);

		const results = [];
		for (const key of list.keys) {
			const value = await placesKV.get(key.name, 'json');
			if (value) results.push(value);
		}

		return json(results);
	} catch (e) {
		console.error('[API:Autocomplete:GET] Error:', e);
		return json([]);
	}
};

export const POST: RequestHandler = async ({ request, platform }) => {
	console.log('[API:Autocomplete:POST] Received save request');
	
	const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;
	
	if (!placesKV) {
		console.error('[API:Autocomplete:POST] ❌ BETA_PLACES_KV is NOT bound! Check hooks.server.ts');
		return json({ success: false, error: 'Database not connected' }, { status: 500 });
	}

	try {
		const body = await request.json();
		console.log('[API:Autocomplete:POST] Payload:', JSON.stringify(body));

		if (!body.formatted_address && !body.name) {
			console.error('[API:Autocomplete:POST] ❌ Missing address/name in payload');
			return json({ success: false, error: 'Invalid data' }, { status: 400 });
		}

		// Use address as key, fallback to name
		const key = (body.formatted_address || body.name).toLowerCase();
		
		console.log(`[API:Autocomplete:POST] Saving to KV with key: "${key}"`);
		await placesKV.put(key, JSON.stringify(body));
		console.log('[API:Autocomplete:POST] ✅ Save successful');

		return json({ success: true, key });
	} catch (e) {
		console.error('[API:Autocomplete:POST] ❌ Save failed:', e);
		return json({ success: false, error: String(e) }, { status: 500 });
	}
};