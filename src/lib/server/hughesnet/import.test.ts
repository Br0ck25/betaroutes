import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { POST } from '../../../routes/api/hughesnet/archived/import/+server';

function makeReq(body: any) {
    return {
        json: async () => body
    } as any;
}

describe('HughesNet archived import API', () => {
    let platform: any;

    beforeEach(() => {
        const event: any = { platform: { env: {} } };
        setupMockKV(event);
        platform = event.platform;
    });

    it('imports selected archived orders into user hns db', async () => {
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;
        const hns = platform.env.BETA_HUGHESNET_KV;
        const owner = 'import_user';
        const orderId = '9001';
        const wrapper = { ownerId: owner, storedAt: Date.now(), order: { id: orderId, address: '9001 Test Pl' } };
        await kv.put(`hns:order:${orderId}`, JSON.stringify(wrapper));

        const event: any = { platform, locals: { user: { name: owner } }, request: makeReq({ ids: [orderId] }) };
        const res = await POST(event as any);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.imported).toContain(orderId);

        const dbRaw = await hns.get(`hns:db:${owner}`);
        expect(dbRaw).toBeTruthy();
        const db = JSON.parse(dbRaw);
        expect(db[orderId]).toBeTruthy();
        expect(db[orderId].restoredFromArchive).toBe(true);
    });

    it('skips orders not owned by user', async () => {
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;
        const hns = platform.env.BETA_HUGHESNET_KV;
        const owner = 'owner_a';
        const other = 'owner_b';
        const orderId = '9002';
        const wrapper = { ownerId: other, storedAt: Date.now(), order: { id: orderId, address: '9002 Place' } };
        await kv.put(`hns:order:${orderId}`, JSON.stringify(wrapper));

        const event: any = { platform, locals: { user: { name: owner } }, request: makeReq({ ids: [orderId] }) };
        const res = await POST(event as any);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.imported.length).toBe(0);
        expect(body.skipped).toContain(orderId);

        const dbRaw = await hns.get(`hns:db:${owner}`);
        expect(dbRaw).toBe(null);
    });
});
