import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';
import { generatePlaceKey } from '$lib/utils/keys';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    // 1. Security: Block unauthenticated writes
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const place = await request.json();
        const placesKV = platform?.env?.BETA_PLACES_KV as KVNamespace;

        if (!placesKV) {
            console.warn('BETA_PLACES_KV not found for caching');
            return json({ success: false });
        }

        if (!place || (!place.formatted_address && !place.name)) {
            return json({ success: false, error: 'Invalid data' });
        }

        const keyText = place.formatted_address || place.name;
        
        // [!code fix] Use Hashed Key to prevent 512-byte limit errors
        const key = await generatePlaceKey(keyText);

        // Save to KV with TTL (60 days)
        await placesKV.put(key, JSON.stringify({
            ...place,
            cachedAt: new Date().toISOString(),
            source: 'autocomplete_selection',
            contributedBy: locals.user.id
        }), { expirationTtl: 5184000 });

        return json({ success: true });

    } catch (e) {
        console.error('Cache Error:', e);
        return json({ success: false, error: String(e) }, { status: 500 });
    }
};