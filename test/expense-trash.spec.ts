import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeExpenseService } from '$lib/server/expenseService';

describe('Expense trash behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('delete stores original in main expenses KV and marks deleted with TTL', async () => {
		const kv = platform.env['BETA_EXPENSES_KV'] as any;
		const svc = makeExpenseService(kv, platform.env['TRIP_INDEX_DO'] as any);

		const userId = 'trash_user';
		const id = 'exp-1';
		const now = new Date().toISOString();
		const expense = {
			id,
			userId,
			date: now,
			category: 'fuel',
			amount: 12.34,
			createdAt: now,
			updatedAt: now
		};

		await kv.put(`expense:${userId}:${id}`, JSON.stringify(expense));

		await svc.delete(userId, id);

		const rawTrash = await kv.get(`expense:${userId}:${id}`);
		expect(rawTrash).toBeTruthy();
		const parsedTrash = JSON.parse(rawTrash);
		expect(parsedTrash.deleted).toBe(true);
		expect(parsedTrash.backup?.id === id).toBeTruthy();
		expect(parsedTrash.deletedBy === userId).toBeTruthy();
		expect(parsedTrash.metadata?.expiresAt).toBeTruthy();

		const list = await svc.listTrash(userId);
		expect(list.length).toBeGreaterThan(0);
		const found = list.find((t) => t.id === id);
		expect(found).toBeTruthy();
		expect(found?.category || found?.amount).toBeTruthy();

		// Restore
		await svc.restore(userId, id);

		const afterExpense = JSON.parse(await kv.get(`expense:${userId}:${id}`));
		expect(afterExpense.deleted).toBe(undefined);
		expect(afterExpense.category).toBe('fuel');
	});
});
