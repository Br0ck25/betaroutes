import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
    const query = event.url.searchParams.get('q');

    // Must extract platform from event
    const platform = event.platform;
    const placesKV = platform?.env?.BETA_PLACES_KV;

    if (!query || query.length < 2) {
        return json([]);
    }

    // Debug test
    if (query.toLowerCase().includes('test')) {
        return json([
            {
                formatted_address: "TEST CONNECTION SUCCESSFUL",
                name: "Debug Result",
                geometry: { location: { lat: 0, lng: 0 } }
            }
        ]);
    }

    if (!placesKV) {
        return json([
            {
                formatted_address: "Error: KV binding missing",
                name: "System Error"
            }
        ]);
    }

    try {
        const prefix = query.toLowerCase().trim();

        const list = await placesKV.list({
            prefix,
            limit: 5
        });

        const results: any[] = [];

        for (const key of list.keys) {
            try {
                const raw = await placesKV.get(key.name);

                if (raw) {
                    results.push(JSON.parse(raw));
                } else {
                    throw new Error("empty");
                }
            } catch {
                results.push({
                    formatted_address: key.name,
                    name: key.name,
                    geometry: { location: { lat: 0, lng: 0 } },
                    _fallback: true
                });
            }
        }

        return json(results);

    } catch (err) {
        return json([
            {
                formatted_address: "Server Error",
                name: String(err)
            }
        ]);
    }
};
