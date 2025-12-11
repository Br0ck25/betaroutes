import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

export const POST: RequestHandler = async ({ request, platform }) => {
    try {
        const place = await request.json();
        const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

        if (!placesKV) {
            // Silently fail in dev if KV isn't set up, to prevent UI errors
            console.warn('BETA_PLACES_KV not found for caching');
            return json({ success: false });
        }

        if (!place || (!place.formatted_address && !place.name)) {
            return json({ success: false, error: 'Invalid data' });
        }

        // Use the address as the lookup key (normalized)
        const keyText = place.formatted_address || place.name;
        const key = keyText.toLowerCase().trim();

        // Save to KV with a flag indicating it came from user selection
        await placesKV.put(key, JSON.stringify({
            ...place,
            cachedAt: new Date().toISOString(),
            source: 'autocomplete_selection'
        }));

        return json({ success: true });

    } catch (e) {
        console.error('Cache Error:', e);
        return json({ success: false, error: String(e) }, { status: 500 });
    }
};