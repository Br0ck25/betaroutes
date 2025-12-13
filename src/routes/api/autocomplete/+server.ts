// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
    const query = url.searchParams.get('q');
    
    if (!query || query.length < 2) {
        return json([]);
    }

    try {
        // 1. Try KV Cache First (Free)
        const kv = platform?.env?.BETA_PLACES_KV;
        if (kv) {
            const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
            const searchPrefix = normalizedQuery.substring(0, 10);
            
            const bucketKey = `prefix:${searchPrefix}`;
            const bucketRaw = await kv.get(bucketKey);

            if (bucketRaw) {
                const bucket = JSON.parse(bucketRaw);
                // Return cached results immediately if found
                return json(bucket);
            }
        }

        // 2. Google Fallback (Cost: $2.83/1000 reqs)
        // Only runs if KV missed AND we have the private key
        const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            return json([]);
        }

        // Call Google Places Autocomplete API (Server-Side)
        const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode`;
        
        const response = await fetch(googleUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.predictions) {
            // Transform to match your frontend expected format if needed, 
            // or pass prediction objects directly.
            return json(data.predictions);
        }

        return json([]);

    } catch (err) {
        console.error('Autocomplete Error:', err);
        return json([]);
    }
};