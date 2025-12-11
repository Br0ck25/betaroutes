import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    // 1. Validation
    if (!query || query.length < 2) {
        return json([]);
    }

    // --- DEBUG: HARDCODED BYPASS ---
    // Type "test" in the input to verify the API is actually running.
    if (query.toLowerCase().includes('test')) {
        console.log('[API] Returning debug result');
        return json([{
            formatted_address: "TEST RESULT: API IS WORKING",
            name: "Debug Location",
            geometry: { location: { lat: 0, lng: 0 } }
        }]);
    }
    // -------------------------------

    const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

    // Check if KV is bound
    if (!placesKV) {
        console.error('[API] CRITICAL: BETA_PLACES_KV binding missing!');
        // Return a special error result so you can see it in the dropdown
        return json([{
            formatted_address: "ERROR: KV BINDING MISSING IN CLOUDFLARE",
            name: "System Error"
        }]);
    }

    try {
        const prefix = query.toLowerCase().trim();
        
        // 2. Search KV
        const list = await placesKV.list({ 
            prefix, 
            limit: 5 
        });

        const results = [];

        // 3. Fetch details
        for (const key of list.keys) {
            const raw = await placesKV.get(key.name);
            if (raw) {
                try {
                    results.push(JSON.parse(raw));
                } catch (e) {
                    console.error('JSON parse error', e);
                }
            }
        }

        return json(results);

    } catch (e) {
        console.error('[API] Error:', e);
        return json([{
            formatted_address: `ERROR: ${String(e)}`,
            name: "Server Error"
        }]);
    }
};