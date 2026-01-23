import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { migrateUserStorageKeys } from './storage-key-migration';

describe('storage-key-migration (rebuild mode)', () => {
	let env: Record<string, any>;
	beforeEach(async () => {
		const event = { platform: { env: {} as Record<string, unknown> } } as any;
		await setupMockKV(event);
		env = event.platform.env as Record<string, any>;
	});

	it('creates copies under userId and leaves originals intact', async () => {
		const userName = 'James';
		const userId = '02073319-e5e4-457c-b5d6-870b607c9423';

		// Seed legacy trip
		await env['BETA_LOGS_KV'].put(
			`trip:${userName}:trip1`,
			JSON.stringify({ id: 'trip1', userId: userName, createdAt: new Date().toISOString() })
		);

		// Seed HughesNet order
		await env['BETA_HUGHESNET_ORDERS_KV'].put(
			`hns:order:order1`,
			JSON.stringify({ ownerId: userName, payload: { foo: 'bar' } })
		);

		// Seed hns settings
		await env['BETA_HUGHESNET_KV'].put(
			`hns:settings:${userName}`,
			JSON.stringify({ some: 'settings' })
		);

		const res = await migrateUserStorageKeys(
			{
				BETA_LOGS_KV: env['BETA_LOGS_KV'],
				BETA_EXPENSES_KV: env['BETA_EXPENSES_KV'],
				BETA_MILLAGE_KV: env['BETA_MILLAGE_KV'],
				BETA_TRASH_KV: env['BETA_TRASH_KV'],
				BETA_HUGHESNET_KV: env['BETA_HUGHESNET_KV'],
				BETA_HUGHESNET_ORDERS_KV: env['BETA_HUGHESNET_ORDERS_KV']
			},
			userId,
			userName,
			{ mode: 'rebuild', force: true }
		);

		expect(res.success).toBe(true);
		expect(res.errors.length).toBe(0);

		// Original remains
		const original = await env['BETA_LOGS_KV'].get(`trip:${userName}:trip1`);
		expect(original).toBeTruthy();

		// New copy exists
		const copied = await env['BETA_LOGS_KV'].get(`trip:${userId}:trip1`);
		expect(copied).toBeTruthy();

		// HNS order rebuilt copy exists
		const rebuiltOrderKey = `hns:order:order1:rebuild:${userId}`;
		const rebuiltRaw = await env['BETA_HUGHESNET_ORDERS_KV'].get(rebuiltOrderKey);
		expect(rebuiltRaw).toBeTruthy();
		const rebuilt = JSON.parse(rebuiltRaw);
		expect(rebuilt.ownerId).toBe(userId);

		// HNS settings copy exists
		const newHns = await env['BETA_HUGHESNET_KV'].get(`hns:settings:${userId}`);
		expect(newHns).toBeTruthy();

		// Migration marker should be set
		const marker = await env['BETA_LOGS_KV'].get(`migration:username_to_id:completed:${userId}`);
		expect(marker).toBeTruthy();
	});
});
