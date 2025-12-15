// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Helper to normalize keys (Lowercase, remove spaces, limit length)
function normalizeKey(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
    // 1. Security: Scope to User
    if (!locals.user || !locals.user.id) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = locals.user.id;

    const query = url.searchParams.get('q');
    const placeId = url.searchParams.get('placeid');
    const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;

    // --- MODE A: PLACE DETAILS ---
    if (placeId) {
        if (!apiKey) return json({ error: 'Server config error' }, { status: 500 });
        try {
            // Check cache first? (Optional, but safe if scoped)
            // For now, we hit Google directly for fresh details
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,name,formatted_address&key=${apiKey}`;
            const res = await fetch(detailsUrl);
            const data = await res.json();
            if (data.status === 'OK' && data.result) {
                return json(data.result);
            }
            return json({ error: data.status }, { status: 400 });
        } catch (e) {
            return json({ error: 'Failed to fetch details' }, { status: 500 });
        }
    }

    // --- MODE B: AUTOCOMPLETE SEARCH ---
    if (!query || query.length < 2) return json([]);

    try {
        const kv = platform?.env?.BETA_PLACES_KV;
        const normalizedQuery = normalizeKey(query);
        const prefix = normalizedQuery.substring(0, 10);
        
        // [!code fix] Scoped Key: prefix:{userId}:{fragment}
        const bucketKey = `prefix:${userId}:${prefix}`;

        // 1. Try KV Cache (User Scoped)
        if (kv) {
            const bucketRaw = await kv.get(bucketKey);
            if (bucketRaw) {
                const bucket = JSON.parse(bucketRaw);
                const matches = bucket.filter((item: any) => {
                    const str = (item.formatted_address || item.name || '').toLowerCase();
                    return str.includes(query.toLowerCase());
                });

                if (matches.length > 0) {
                    // Return cached results (mark source)
                    return json(matches.map((m: any) => ({ ...m, source: 'cache' })));
                }
            }
        }

        // 2. Google Fallback
        if (!apiKey) return json([]);

        const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode&components=country:us`;
        const response = await fetch(googleUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.predictions) {
            const results = data.predictions.map((p: any) => ({
                formatted_address: p.description,
                name: p.structured_formatting?.main_text || p.description,
                place_id: p.place_id,
                source: 'google'
            }));

            // 3. Server-Side Caching (Self-Healing Cache)
            // We cache these results into the user's bucket immediately
            if (kv && results.length > 0) {
                // Background execution to not block response
                platform.context.waitUntil((async () => {
                    try {
                        // Generate all prefixes for the query (e.g., "123", "123m", "123ma")
                        // to populate the index for future keystrokes
                        const prefixes = new Set<string>();
                        for (let i = 2; i <= Math.min(10, normalizedQuery.length); i++) {
                            prefixes.add(normalizedQuery.substring(0, i));
                        }

                        for (const p of prefixes) {
                            const k = `prefix:${userId}:${p}`;
                            const existing = await kv.get(k);
                            let bucket = existing ? JSON.parse(existing) : [];
                            
                            // Merge
                            for (const r of results) {
                                if (!bucket.some((b: any) => b.formatted_address === r.formatted_address)) {
                                    bucket.push(r);
                                }
                            }
                            
                            // Cap size
                            if (bucket.length > 20) bucket = bucket.slice(0, 20);
                            
                            await kv.put(k, JSON.stringify(bucket), { expirationTtl: 86400 * 30 });
                        }
                    } catch (err) {
                        console.error('Background Cache Error:', err);
                    }
                })());
            }

            return json(results);
        }

        return json([]);

    } catch (err) {
        console.error('Autocomplete Error:', err);
        return json([]);
    }
};