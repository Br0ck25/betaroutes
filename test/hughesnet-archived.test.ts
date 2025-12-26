import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '../src/lib/server/dev-mock-db';
import { GET } from '../src/routes/api/hughesnet/archived/+server';

function makeUrl(q = '') {
    return new URL('http://localhost' + (q ? `/?${q}` : ''));
}

describe('HughesNet archived orders API', () => {
    let platform: any;

    beforeEach(() => {
        const event: any = { platform: { env: {} } };
        setupMockKV(event);
        platform = event.platform;
    });

    it('returns archived order for owner by id and lists owned orders', async () => {
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;
        const ownerId = 'test_user_1';
        const orderId = '5555';
        const wrapper = { ownerId, storedAt: Date.now(), order: { id: orderId, address: '123 Test Lane' } };
        await kv.put(`hns:order:${orderId}`, JSON.stringify(wrapper));

        // fetch by id
        const resById = await GET({ platform, locals: { user: { name: ownerId } }, url: makeUrl(`id=${orderId}`) } as any);
        const bodyById = await resById.json();
        expect(bodyById.success).toBe(true);
        expect(bodyById.order.id).toBe(orderId);

        // list
        const resList = await GET({ platform, locals: { user: { name: ownerId } }, url: makeUrl() } as any);
        const bodyList = await resList.json();
        expect(bodyList.success).toBe(true);
        expect(Array.isArray(bodyList.orders)).toBe(true);
        expect(bodyList.orders.some((o: any) => o.id === orderId)).toBe(true);
    });

    it('does not return orders owned by other users', async () => {
        const kv = platform.env.BETA_HUGHESNET_ORDERS_KV;
        const ownerId = 'test_user_2';
        const otherOwner = 'someone_else';
        const orderId = '6666';
        const wrapper = { ownerId: otherOwner, storedAt: Date.now(), order: { id: orderId, address: '456 Other' } };
        await kv.put(`hns:order:${orderId}`, JSON.stringify(wrapper));

        const res = await GET({ platform, locals: { user: { name: ownerId } }, url: makeUrl(`id=${orderId}`) } as any);
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
    });
});
