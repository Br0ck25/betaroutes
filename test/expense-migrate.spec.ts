import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeExpenseService } from '$lib/server/expenseService';

describe('Expense migrate behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('does not migrate tombstones as active items (uses backup instead)', async () => {
		const kv = platform.env['BETA_EXPENSES_KV'] as any;
		const userId = 'migrate_user';
		// Tombstone with backup
		await kv.put(
			`expense:${userId}:exp-deleted`,
			JSON.stringify({
				id: 'exp-deleted',
				userId,
				deleted: true,
				backup: {
					id: 'exp-deleted',
					userId,
					category: 'parts',
					amount: 5.0,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			})
		);

		// Active expense
		await kv.put(
			`expense:${userId}:exp-active`,
			JSON.stringify({
				id: 'exp-active',
				userId,
				category: 'fuel',
				amount: 12.34,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);

		const svc = makeExpenseService(kv, platform.env['TRIP_INDEX_DO'] as any);
		const list = await svc.list(userId);

		expect(list.some((e) => e.id === 'exp-active')).toBe(true);
		expect(list.some((e) => e.id === 'exp-deleted')).toBe(true);

		// Ensure deleted flag is not present in migrated item
		const migrated = list.find((e) => e.id === 'exp-deleted');
		expect(migrated && (migrated as any).deleted).toBeFalsy();
	});
});
