// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    if (!query || query.length < 2) {
        return json([]);
    }

    try {
        const kv = platform?.env?.BETA_PLACES_KV;
        if (!kv) return json([]);

        // 1. Normalize query to match the cache key format
        const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
        const searchPrefix = normalizedQuery.substring(0, 10);
        
        // 2. Direct Bucket Lookup (1 KV Call)
        // The key 'prefix:xyz' now contains the full JSON array of results
        const bucketKey = `prefix:${searchPrefix}`;
        const bucketRaw = await kv.get(bucketKey);

        if (!bucketRaw) {
            return json([]);
        }

        const bucket = JSON.parse(bucketRaw);

        // 3. Return results
        return json(bucket);

    } catch (err) {
        console.error('Autocomplete Error:', err);
        return json([]);
    }
};