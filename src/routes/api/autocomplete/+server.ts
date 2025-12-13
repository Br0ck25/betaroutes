// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    // The cache logic writes keys starting at length 2, so we skip anything shorter
    if (!query || query.length < 2) {
        return json([]);
    }

    try {
        const kv = platform?.env?.BETA_PLACES_KV;
        if (!kv) return json([]);

        // 1. Normalize query to match the Writer's logic (from api/autocomplete/cache/+server.ts)
        // The cache normalized it by lowercasing and removing spaces
        const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
        
        // 2. Determine the prefix to list
        // The cache loop stops at 10 characters, so we cap the prefix length at 10
        const searchPrefix = normalizedQuery.substring(0, 10);
        
        // This matches the key structure: `prefix:${prefix}:${normalizedAddress}`
        const listPrefix = `prefix:${searchPrefix}:`;

        // 3. List keys instead of Getting a bucket
        // This finds all keys that match the user's input prefix
        const listResult = await kv.list({ prefix: listPrefix, limit: 5 });

        if (listResult.keys.length === 0) {
            return json([]);
        }

        // 4. Fetch the values for the keys found
        // KV List only returns metadata/names, so we have to get the actual JSON objects
        const matchPromises = listResult.keys.map(key => kv.get(key.name, 'json'));
        const matchesRaw = await Promise.all(matchPromises);

        // Filter out any nulls (in case a key expired during the fetch)
        const matches = matchesRaw.filter(m => m !== null);

        return json(matches);

    } catch (err) {
        console.error('Autocomplete Error:', err);
        return json([]); // Fail gracefully
    }
};