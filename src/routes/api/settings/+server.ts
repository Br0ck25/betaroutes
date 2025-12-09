// src/routes/api/settings/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const kv = platform?.env?.BETA_USER_SETTINGS_KV;
    if (!kv) return json({}); // Return empty if KV missing

    try {
        // Use user.id as the key
        const data = await kv.get(locals.user.id);
        return json(data ? JSON.parse(data) : {});
    } catch (err) {
        console.error('KV Get Error:', err);
        return json({});
    }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const kv = platform?.env?.BETA_USER_SETTINGS_KV;
    if (!kv) return json({ error: 'KV not found' }, { status: 500 });

    try {
        const body = await request.json();
        const key = locals.user.id; // Use user.id
        
        // Merge with existing data
        const existingRaw = await kv.get(key);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        
        const updated = { ...existing, ...body };
        
        await kv.put(key, JSON.stringify(updated));
        
        return json({ success: true, data: updated });
    } catch (err) {
        console.error('KV Save Error:', err);
        return json({ error: 'Failed to save' }, { status: 500 });
    }
};