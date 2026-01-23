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

		// New copy exists (or a rebuilt copy may have been created when a different newKey already existed)
		const copied = await env['BETA_LOGS_KV'].get(`trip:${userId}:trip1`);
		// Accept either the canonical new key or a rebuilt copy with normalized value
		if (copied) {
			const copiedObj = JSON.parse(copied);
			if (copiedObj.userId === userId) {
				expect(copiedObj.userId).toBe(userId);
			} else {
				// If the canonical key already existed with different data, a rebuilt copy should exist with normalized value
				const rebuiltKey = `trip:${userId}:trip1:rebuild:${userId}`;
				const rebuiltRaw = await env['BETA_LOGS_KV'].get(rebuiltKey);
				expect(rebuiltRaw).toBeTruthy();
				expect(JSON.parse(rebuiltRaw).userId).toBe(userId);
			}
		} else {
			const rebuiltKey = `trip:${userId}:trip1:rebuild:${userId}`;
			const rebuiltRaw = await env['BETA_LOGS_KV'].get(rebuiltKey);
			expect(rebuiltRaw).toBeTruthy();
			expect(JSON.parse(rebuiltRaw).userId).toBe(userId);
		}

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

	it('handles username case-insensitively (seeds with different casing)', async () => {
		const seededUsername = 'James';
		const usedUsername = 'james'; // lowercase passed into migration
		const userId = 'e0d2b3a8-1111-2222-3333-444444444444';

		// Seed legacy trip with capitalized username
		await env['BETA_LOGS_KV'].put(
			`trip:${seededUsername}:trip-ci-1`,
			JSON.stringify({
				id: 'trip-ci-1',
				userId: seededUsername,
				createdAt: new Date().toISOString()
			})
		);

		// Seed hns settings with capitalized username
		await env['BETA_HUGHESNET_KV'].put(
			`hns:settings:${seededUsername}`,
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
			usedUsername,
			{ mode: 'rebuild', force: true }
		);

		expect(res.success).toBe(true);
		expect(res.errors.length).toBe(0);

		// Original seeded record remains
		const original = await env['BETA_LOGS_KV'].get(`trip:${seededUsername}:trip-ci-1`);
		expect(original).toBeTruthy();

		// New copy exists under UUID (or a rebuilt copy may have been created)
		const copied = await env['BETA_LOGS_KV'].get(`trip:${userId}:trip-ci-1`);
		if (copied) {
			const copiedObj = JSON.parse(copied);
			if (copiedObj.userId === userId) {
				expect(copiedObj.userId).toBe(userId);
			} else {
				const rebuiltKey = `trip:${userId}:trip-ci-1:rebuild:${userId}`;
				const rebuiltRaw = await env['BETA_LOGS_KV'].get(rebuiltKey);
				expect(rebuiltRaw).toBeTruthy();
				expect(JSON.parse(rebuiltRaw).userId).toBe(userId);
			}
		} else {
			const rebuiltKey = `trip:${userId}:trip-ci-1:rebuild:${userId}`;
			const rebuiltRaw = await env['BETA_LOGS_KV'].get(rebuiltKey);
			expect(rebuiltRaw).toBeTruthy();
			expect(JSON.parse(rebuiltRaw).userId).toBe(userId);
		}

		// HNS settings copy exists
		const newHns = await env['BETA_HUGHESNET_KV'].get(`hns:settings:${userId}`);
		expect(newHns).toBeTruthy();

		// Migration marker should be set
		const marker = await env['BETA_LOGS_KV'].get(`migration:username_to_id:completed:${userId}`);
		expect(marker).toBeTruthy();
	});
});
