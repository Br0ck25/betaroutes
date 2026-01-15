import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { HughesNetService } from '$lib/server/hughesnet/service';

describe('HughesNet service archived write smoke test', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('processOrderData writes a wrapped order to orders KV', async () => {
		const svc = new HughesNetService(
			platform.env['BETA_HUGHESNET_KV'] as any,
			'enc-key',
			platform.env['BETA_LOGS_KV'] as any,
			undefined,
			platform.env['BETA_USER_SETTINGS_KV'] as any,
			undefined,
			platform.env['BETA_DIRECTIONS_KV'] as any,
			platform.env['BETA_HUGHESNET_ORDERS_KV'] as any,
			platform.env['BETA_LOGS_KV'] as any,
			platform.env['TRIP_INDEX_DO'] as any
		);

		const owner = 'smoke_user';
		const id = '7000';
		const parsedOrder = {
			id: id,
			address: '99 Smoke St',
			confirmScheduleDate: '12/31/2025',
			arrivalTimestamp: Date.now()
		} as unknown;

		const orderDb: Record<string, unknown> = {};

		const changed = await (
			svc as unknown as {
				processOrderData: (
					db: Record<string, unknown>,
					id: string,
					parsed: unknown,
					owner: string
				) => Promise<boolean>;
			}
		).processOrderData(orderDb, id, parsedOrder, owner);
		expect(changed).toBe(true);

		const raw = await (platform.env['BETA_HUGHESNET_ORDERS_KV'] as any).get(`hns:order:${id}`);
		expect(raw).toBeTruthy();
		const wrapper = JSON.parse(raw);
		expect(wrapper.ownerId).toBe(owner);
		expect(wrapper.order.id).toBe(id);
	});
});
