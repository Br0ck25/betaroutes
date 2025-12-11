import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    console.log(`[API] Autocomplete request for: "${query}"`);

    // 1. Validation
    if (!query || query.length < 2) {
        return json([]);
    }

    // DEBUG: Check if Platform/Env exists
    if (!platform) {
        console.error('[API] Error: "platform" object is missing. Are you running locally without miniflare/wrangler?');
    } else if (!platform.env) {
        console.error('[API] Error: "platform.env" is missing.');
    }

    const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;
    
    // DEBUG: Explicit check for KV binding
    if (!placesKV) {
        console.warn('[API] CRITICAL: BETA_PLACES_KV binding not found on platform.env!');
        console.warn('[API] Available env vars:', platform?.env ? Object.keys(platform.env) : 'None');
        // Return empty but don't crash, so we can see the logs
        return json([]);
    } else {
        console.log('[API] BETA_PLACES_KV binding found.');
    }

    try {
        const prefix = query.toLowerCase().trim();
        console.log(`[API] Searching KV with prefix: "${prefix}"`);

        // 3. Search KV
        const list = await placesKV.list({ 
            prefix, 
            limit: 5 
        });

        console.log(`[API] KV list() returned ${list.keys.length} keys.`);

        const results = [];

        // 4. Fetch details
        for (const key of list.keys) {
            console.log(`[API] Fetching details for key: ${key.name}`);
            const raw = await placesKV.get(key.name);
            if (raw) {
                try {
                    const place = JSON.parse(raw);
                    results.push(place);
                } catch (e) {
                    console.error(`[API] JSON parse error for key ${key.name}`);
                }
            }
        }

        console.log(`[API] Returning ${results.length} full results.`);
        return json(results);

    } catch (e) {
        console.error('[API] Autocomplete Error:', e);
        return json({ error: String(e) }, { status: 500 });
    }
};