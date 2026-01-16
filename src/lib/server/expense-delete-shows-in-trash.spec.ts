import { describe, it, expect } from 'vitest';
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeExpenseService } from '$lib/server/expenseService';

type MockEvent = {
	platform: { env: Record<string, unknown> };
	locals: { user: { name: string } };
	params: { id: string };
};

describe('Expense delete should appear in cloud trash (username keying)', () => {
	it('svc.delete writes tombstone visible via listTrash when using username keys', async () => {
		const event: MockEvent = {
			platform: { env: {} },
			locals: { user: { name: 'test_user' } },
			params: { id: 'exp-1' }
		};
		setupMockKV(event);

		// Put an initial expense in the expenses KV so svc.get can find it
		const kv = event.platform.env['BETA_EXPENSES_KV'] as unknown as KVNamespace;
		const expense = {
			id: 'exp-1',
			userId: 'test_user',
			amount: 12.34,
			category: 'food',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		await kv.put(`expense:test_user:exp-1`, JSON.stringify(expense));

		// Use service directly with username-based storage id
		const svc = makeExpenseService(
			kv,
			event.platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace
		);
		await svc.delete('test_user', 'exp-1');

		// Now list trash
		const list = await svc.listTrash('test_user');
		expect(Array.isArray(list)).toBe(true);
		expect(list.some((i: { id?: string }) => i.id === 'exp-1')).toBe(true);
	});
});
