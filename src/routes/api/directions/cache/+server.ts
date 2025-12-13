import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

function generateKey(start: string, end: string) {
    return `dir:${start.toLowerCase().trim()}_to_${end.toLowerCase().trim()}`;
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
    // 1. Security: Ensure user is logged in
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    if (!start || !end) {
        return json({ error: 'Missing start or end address' }, { status: 400 });
    }

    const kv = platform?.env?.BETA_DIRECTIONS_KV as KVNamespace;
    const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;
    const key = generateKey(start, end);

    // 2. Try Cloudflare KV Cache (Free & Fast)
    if (kv) {
        const cachedRaw = await kv.get(key);
        if (cachedRaw) {
            const data = JSON.parse(cachedRaw);
            return json({ source: 'cache', data });
        }
    }

    // 3. Fallback: Call Google Directions API (Server-Side)
    if (!apiKey) {
        console.error('PRIVATE_GOOGLE_MAPS_API_KEY is missing');
        return json({ error: 'Server configuration error' }, { status: 500 });
    }

    try {
        console.log(`[API] Fetching Route from Google: ${start} -> ${end}`);
        const googleUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(start)}&destination=${encodeURIComponent(end)}&key=${apiKey}`;
        
        const response = await fetch(googleUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.routes?.[0]?.legs?.[0]) {
            const leg = data.routes[0].legs[0];
            
            // Standardize Format: Meters & Seconds
            const result = {
                distance: leg.distance.value, 
                duration: leg.duration.value 
            };

            // Save to KV (1 Year Cache)
            if (kv) {
                await kv.put(key, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 365 });
            }

            return json({ source: 'google', data: result });
        }
        
        return json({ error: 'Route not found', details: data.status }, { status: 404 });

    } catch (e) {
        console.error('[API] Directions Proxy Error:', e);
        return json({ error: 'Failed to calculate route' }, { status: 500 });
    }
};