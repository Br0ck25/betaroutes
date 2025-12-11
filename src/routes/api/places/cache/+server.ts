import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const POST: RequestHandler = async ({ request, platform }) => {
    try {
        const place = await request.json();
        const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

        if (!placesKV) {
            console.warn('BETA_PLACES_KV not found during cache attempt');
            return json({ success: false, error: 'KV not found' });
        }

        if (!place || (!place.formatted_address && !place.name)) {
            return json({ success: false, error: 'Invalid place data' });
        }

        // We use the address as the key for autocomplete lookup
        // Normalize: lowercase and trim
        const keyText = place.formatted_address || place.name;
        const key = keyText.toLowerCase().trim();

        // Save to KV
        // We add a 'cachedAt' timestamp so we know this came from the "Save on Select" feature
        await placesKV.put(key, JSON.stringify({
            ...place,
            cachedAt: new Date().toISOString(),
            source: 'user_selection'
        }));

        return json({ success: true });

    } catch (e) {
        console.error('Error caching place:', e);
        return json({ success: false, error: String(e) }, { status: 500 });
    }
};