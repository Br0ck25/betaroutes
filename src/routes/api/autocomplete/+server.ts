import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    // 1. Validation
    if (!query || query.length < 2) {
        return json([]);
    }

    // --- DEBUG: TEST BYPASS ---
    // Type "test" to prove the frontend can talk to the backend
    if (query.toLowerCase().includes('test')) {
        return json([{
            formatted_address: "TEST CONNECTION SUCCESSFUL",
            name: "Debug Result",
            geometry: { location: { lat: 0, lng: 0 } }
        }]);
    }

    const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

    if (!placesKV) {
        // Return a visible error in the dropdown if binding fails
        return json([{
            formatted_address: "Error: Database Disconnected",
            name: "System Error"
        }]);
    }

    try {
        const prefix = query.toLowerCase().trim();
        
        // 2. Search KV (Prefix match only!)
        // Note: Searching "Buzzard" will NOT find "101 Buzzard". 
        // You must search "101".
        const list = await placesKV.list({ 
            prefix, 
            limit: 5 
        });

        const results = [];

        // 3. Fetch details with FAILSAFE
        for (const key of list.keys) {
            try {
                const raw = await placesKV.get(key.name);
                
                if (raw) {
                    // Try to parse the stored JSON data
                    const place = JSON.parse(raw);
                    results.push(place);
                } else {
                    throw new Error('Empty value');
                }
            } catch (e) {
                // FAILSAFE: If JSON is invalid or value is missing,
                // verify we can at least see the key in the dropdown.
                // This proves the "search" works even if "data" is broken.
                console.warn(`[KV] Corrupt data for ${key.name}, using fallback.`);
                results.push({
                    formatted_address: key.name, // Use the key itself
                    name: key.name,
                    geometry: { location: { lat: 0, lng: 0 } },
                    _isFallback: true
                });
            }
        }

        return json(results);

    } catch (e) {
        console.error('[API] Error:', e);
        return json([{
            formatted_address: `System Error: ${String(e)}`,
            name: "Error"
        }]);
    }
};