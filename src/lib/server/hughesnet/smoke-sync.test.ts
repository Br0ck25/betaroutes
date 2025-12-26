import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { HughesNetService } from '$lib/server/hughesnet/service';

describe('HughesNet service archived write smoke test', () => {
    let platform: any;

    beforeEach(() => {
        const event: any = { platform: { env: {} } };
        setupMockKV(event);
        platform = event.platform;
    });

    it('processOrderData writes a wrapped order to orders KV', async () => {
        const svc = new HughesNetService(
            platform.env.BETA_HUGHESNET_KV,
            'enc-key',
            platform.env.BETA_LOGS_KV,
            platform.env.BETA_LOGS_TRASH_KV,
            platform.env.BETA_USER_SETTINGS_KV,
            undefined,
            platform.env.BETA_DIRECTIONS_KV,
            platform.env.BETA_HUGHESNET_ORDERS_KV,
            platform.env.BETA_LOGS_KV,
            platform.env.TRIP_INDEX_DO
        );

        const owner = 'smoke_user';
        const id = '7000';
        const parsedOrder = {
            id: id,
            address: '99 Smoke St',
            confirmScheduleDate: '12/31/2025',
            arrivalTimestamp: Date.now()
        } as any;

        const orderDb: Record<string, any> = {};

        const changed = await (svc as any).processOrderData(orderDb, id, parsedOrder, owner);
        expect(changed).toBe(true);

        const raw = await platform.env.BETA_HUGHESNET_ORDERS_KV.get(`hns:order:${id}`);
        expect(raw).toBeTruthy();
        const wrapper = JSON.parse(raw);
        expect(wrapper.ownerId).toBe(owner);
        expect(wrapper.order.id).toBe(id);
    });
});
