import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals, request }) => {
    if (!platform?.env?.BETA_HUGHESNET_ORDERS_KV || !platform?.env?.BETA_HUGHESNET_KV) {
        return json({ success: false, error: 'Orders KV or HNS KV not configured' }, { status: 500 });
    }

    const userId = locals.user?.name || locals.user?.token || locals.user?.id || 'default_user';
    try {
        const body = await request.json();
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;
        const hnsKV = platform.env.BETA_HUGHESNET_KV;

        let ids: string[] = [];
        if (body.all) {
            const listRes = await kv.list({ prefix: 'hns:order:' });
            const keys = listRes.keys || [];
            for (const k of keys) {
                const raw = await kv.get(k.name);
                if (!raw) continue;
                try {
                    const p = JSON.parse(raw);
                    if (p && p.ownerId === userId && p.order && p.order.id) ids.push(String(p.order.id));
                } catch (e) { }
            }
        } else if (Array.isArray(body.ids)) {
            ids = body.ids.map(String);
        } else if (body.id) {
            ids = [String(body.id)];
        } else {
            return json({ success: false, error: 'No ids supplied' }, { status: 400 });
        }

        // Load user's HNS DB
        let orderDb: Record<string, any> = {};
        const dbRaw = await hnsKV.get(`hns:db:${userId}`);
        if (dbRaw) {
            try { orderDb = JSON.parse(dbRaw); } catch (e) { orderDb = {}; }
        }

        const imported: string[] = [];
        const skipped: string[] = [];

        for (const id of ids) {
            try {
                const raw = await kv.get(`hns:order:${id}`);
                if (!raw) { skipped.push(id); continue; }
                const wrapper = JSON.parse(raw);
                if (!wrapper || wrapper.ownerId !== userId || !wrapper.order) { skipped.push(id); continue; }
                if (orderDb[id] && orderDb[id].address) { skipped.push(id); continue; }
                const order = { ...wrapper.order, restoredFromArchive: true, lastSyncTimestamp: Date.now() };
                orderDb[id] = order;
                imported.push(id);
            } catch (e) {
                skipped.push(id);
            }
        }

        if (imported.length > 0) {
            await hnsKV.put(`hns:db:${userId}`, JSON.stringify(orderDb));
        }

        return json({ success: true, imported, skipped });

    } catch (e: any) {
        return json({ success: false, error: e.message || 'Server error' }, { status: 500 });
    }
};