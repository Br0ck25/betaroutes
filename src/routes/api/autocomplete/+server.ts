import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    // 1. Validation
    if (!query || query.length < 2) {
        return json([]);
    }

    const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;
    if (!placesKV) {
        // Fallback for local dev if KV isn't mocked properly
        console.warn('BETA_PLACES_KV not found');
        return json([]);
    }

    try {
        // 2. Normalize Query to Lowercase
        // This is the CRITICAL FIX. The DB has "las vegas", so we must search for "las".
        const prefix = query.toLowerCase().trim();

        // 3. Search KV
        const list = await placesKV.list({ 
            prefix, 
            limit: 5 // Limit results to keep it fast
        });

        const results = [];

        // 4. Fetch details for each match
        for (const key of list.keys) {
            const raw = await placesKV.get(key.name);
            if (raw) {
                try {
                    const place = JSON.parse(raw);
                    results.push(place);
                } catch (e) {
                    // Ignore corrupted entries
                }
            }
        }

        return json(results);

    } catch (e) {
        console.error('Autocomplete Error:', e);
        return json({ error: String(e) }, { status: 500 });
    }
};