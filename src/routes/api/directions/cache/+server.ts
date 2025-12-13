import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { KVNamespace } from '@cloudflare/workers-types';

// Helper to match HughesNet key generation exactly
function generateKey(start: string, end: string) {
    return `dir:${start.toLowerCase().trim()}_to_${end.toLowerCase().trim()}`;
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
    // 1. Security check
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');

    if (!start || !end) return json({ error: 'Missing start or end' }, { status: 400 });

    const kv = platform?.env?.BETA_DIRECTIONS_KV as KVNamespace;
    if (!kv) return json({ error: 'KV not configured' }, { status: 500 });

    // 2. Try to find in KV
    const key = generateKey(start, end);
    const cachedRaw = await kv.get(key);

    if (cachedRaw) {
        const data = JSON.parse(cachedRaw);
        // Returns data in { distance: meters, duration: seconds }
        return json({ found: true, data });
    }

    return json({ found: false });
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { start, end, distanceMeters, durationSeconds } = await request.json();

    if (!start || !end || distanceMeters === undefined) {
        return json({ success: false }, { status: 400 });
    }

    const kv = platform?.env?.BETA_DIRECTIONS_KV as KVNamespace;
    if (!kv) return json({ success: false });

    const key = generateKey(start, end);
    
    // Save in HughesNet format: { distance: meters, duration: seconds }
    const payload = { 
        distance: distanceMeters, 
        duration: durationSeconds 
    };

    await kv.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 365 }); // 1 Year Cache

    return json({ success: true });
};