import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { toIsoDate, extractDateFromTs } from '$lib/server/hughesnet/utils';

import { getEnv, safeKV } from '$lib/server/env';

export const POST: RequestHandler = async ({ platform, locals, request }) => {
    // Use helper to normalize platform env access in type-checks
    const env = getEnv(platform);
    if (!env || !safeKV(env, 'BETA_HUGHESNET_ORDERS_KV') || !safeKV(env, 'BETA_HUGHESNET_KV')) {
        return json({ success: false, error: 'Orders KV or HNS KV not configured' }, { status: 500 });
    }

    const userId = (locals.user as any)?.name || (locals.user as any)?.token || (locals.user as any)?.id || 'default_user';
    try {
        const body: any = await request.json();
        const kv = safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')!;
        const hnsKV = safeKV(env, 'BETA_HUGHESNET_KV')!;

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
        const importedDates: string[] = [];

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

                // Compute import date (ISO) for trip sync
                const iso = (order.confirmScheduleDate && toIsoDate(order.confirmScheduleDate)) || (order.arrivalTimestamp && extractDateFromTs(order.arrivalTimestamp));
                if (iso) importedDates.push(iso);
            } catch (e) {
                skipped.push(id);
            }
        }

        if (imported.length > 0) {
            await hnsKV.put(`hns:db:${userId}`, JSON.stringify(orderDb));
        }

        // Deduplicate dates
        const uniqueDates = Array.from(new Set(importedDates));

        return json({ success: true, imported, skipped, importedDates: uniqueDates });

    } catch (e: any) {
        return json({ success: false, error: e.message || 'Server error' }, { status: 500 });
    }
};