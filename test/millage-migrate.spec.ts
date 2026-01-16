import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeMillageService } from '$lib/server/millageService';

describe('Millage migrate behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('does not migrate tombstones as active items (uses backup instead)', async () => {
		const kv = platform.env['BETA_MILLAGE_KV'] as any;
		const userId = 'migrate_user_m';
		// Tombstone with backup
		await kv.put(
			`millage:${userId}:m-deleted`,
			JSON.stringify({
				id: 'm-deleted',
				userId,
				deleted: true,
				backup: {
					id: 'm-deleted',
					userId,
					miles: 8,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			})
		);

		// Active millage
		await kv.put(
			`millage:${userId}:m-active`,
			JSON.stringify({
				id: 'm-active',
				userId,
				miles: 50,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);

		const svc = makeMillageService(kv, platform.env['TRIP_INDEX_DO'] as any);
		const list = await svc.list(userId);

		expect(list.some((e) => e.id === 'm-active')).toBe(true);
		expect(list.some((e) => e.id === 'm-deleted')).toBe(true);

		const migrated = list.find((e) => e.id === 'm-deleted');
		expect(migrated && (migrated as any).deleted).toBeFalsy();
	});
});
