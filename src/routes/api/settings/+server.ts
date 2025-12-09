// src/routes/api/settings/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, platform }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const kv = platform?.env.BETA_USER_SETTINGS_KV;
        if (!kv) {
            console.warn('BETA_USER_SETTINGS_KV not bound');
            return json({}); // Return empty if KV missing in dev
        }

        const data = await kv.get(locals.user.id);
        return json(data ? JSON.parse(data) : {});
    } catch (err) {
        console.error('Error fetching settings:', err);
        return json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
    if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const kv = platform?.env.BETA_USER_SETTINGS_KV;
        
        if (!kv) {
            throw new Error('KV binding missing');
        }

        // Merge with existing data to prevent overwriting other fields (e.g. if saving only profile)
        const existingRaw = await kv.get(locals.user.id);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        
        const updated = { ...existing, ...body };

        await kv.put(locals.user.id, JSON.stringify(updated));

        return json({ success: true, data: updated });
    } catch (err) {
        console.error('Error saving settings:', err);
        return json({ error: 'Failed to save settings' }, { status: 500 });
    }
};