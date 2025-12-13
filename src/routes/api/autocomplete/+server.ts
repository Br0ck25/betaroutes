// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generatePrefixKey, normalizeSearchString } from '$lib/utils/keys';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    if (!query || query.length < 2) {
        return json([]);
    }

    try {
        // [!code change] Use shared key generation to ensure matching against DB
        const prefixKey = generatePrefixKey(query);
        const normalizedQuery = normalizeSearchString(query);

        const kv = platform?.env?.BETA_PLACES_KV;
        
        // If no KV binding (e.g. dev mode without miniflare), return empty
        if (!kv) return json([]);

        // 1. Get the bucket (list of place IDs/Strings starting with this prefix)
        // We assume the bucket contains a JSON array of full address strings
        const bucketData = await kv.get(prefixKey, 'json') as string[] | null;

        if (!bucketData || !Array.isArray(bucketData)) {
            return json([]);
        }

        // 2. Filter in-memory to find exact matches (since prefix is only 10 chars)
        const matches = bucketData
            .filter(address => normalizeSearchString(address).includes(normalizedQuery))
            .slice(0, 5) // Limit results
            .map(address => ({
                formatted_address: address,
                name: address.split(',')[0] // Simple heuristic for name display
            }));

        return json(matches);

    } catch (err) {
        console.error('Autocomplete Error:', err);
        return json([]); // Fail gracefully
    }
};