// src/routes/api/hughesnet/archived/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals, url }) => {
    if (!platform?.env?.BETA_HUGHESNET_ORDERS_KV) {
        return json({ success: false, error: 'Orders KV not configured' }, { status: 500 });
    }

    const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
    const id = url.searchParams.get('id');

    try {
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;

        if (id) {
            const raw = await kv.get(`hns:order:${id}`);
            if (!raw) return json({ success: false, error: 'Not found' }, { status: 404 });
            let parsed;
            try { parsed = JSON.parse(raw); } catch (e) { return json({ success: false, error: 'Corrupt record' }, { status: 500 }); }
            if (parsed.ownerId !== userId) return json({ success: false, error: 'Not found' }, { status: 404 });
            return json({ success: true, order: parsed.order });
        }

        // list all keys and return those owned by the current user
        const listRes = await kv.list({ prefix: 'hns:order:' });
        const keys = listRes.keys || [];
        const results: Array<{ id: string; storedAt?: number; order: any }> = [];
        for (const k of keys) {
            const raw = await kv.get(k.name);
            if (!raw) continue;
            try {
                const p = JSON.parse(raw);
                if (p && p.ownerId === userId && p.order) {
                    results.push({ id: k.name.replace(/^hns:order:/, ''), storedAt: p.storedAt, order: p.order });
                }
            } catch (e) { /* skip corrupt */ }
        }

        return json({ success: true, orders: results });
    } catch (e: any) {
        return json({ success: false, error: e.message || 'Server error' }, { status: 500 });
    }
};