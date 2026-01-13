import { describe, it, expect } from 'vitest';
import { makeExpenseService } from './expenseService';

class MockKV {
	storage = new Map<string, string>();

	async get(key: string) {
		return this.storage.has(key) ? this.storage.get(key) : null;
	}

	async put(key: string, value: string, _opts?: any) {
		this.storage.set(key, value);
	}

	async list({ prefix }: { prefix: string }) {
		const keys = Array.from(this.storage.keys())
			.filter((k) => k.startsWith(prefix))
			.map((name) => ({ name }));
		return { keys, list_complete: true };
	}
}

class MockDOStub {
	responses: Record<string, any> = {};

	idFromName() {
		return 'stub';
	}
	get() {
		return this;
	}
	async fetch(url: string, _opts?: any) {
		if (url.endsWith('/expenses/list')) {
			return { ok: true, json: async () => [] };
		}
		if (url.endsWith('/expenses/status')) {
			return { ok: true, json: async () => ({ needsMigration: false }) };
		}
		if (url.endsWith('/expenses/migrate')) {
			return { ok: true };
		}
		if (url.endsWith('/expenses/put')) {
			return { ok: true };
		}
		return { ok: true, json: async () => ({}) };
	}
}

describe('ExpenseService multi-KV support', () => {
	it('put should write to all configured KVs', async () => {
		const kv1 = new MockKV();
		const kv2 = new MockKV();
		const doStub = new MockDOStub();

		const svc = makeExpenseService([kv1 as any, kv2 as any], doStub as any);

		const expense = {
			id: 'exp1',
			userId: 'user1',
			date: '2025-01-01',
			category: 'maintenance',
			amount: 10,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		await svc.put(expense as any);

		expect(kv1.storage.has(`expense:user1:exp1`)).toBe(true);
		expect(kv2.storage.has(`expense:user1:exp1`)).toBe(true);
	});

	it('delete should write tombstones to all KVs', async () => {
		const kv1 = new MockKV();
		const kv2 = new MockKV();
		const doStub = new MockDOStub();

		// Pre-seed one expense in kvs (KV-only)
		const payload = JSON.stringify({
			id: 'exp2',
			userId: 'user2',
			date: '2025-01-02',
			amount: 5,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});
		await kv1.put('expense:user2:exp2', payload);
		await kv2.put('expense:user2:exp2', payload);

		const svc = makeExpenseService([kv1 as any, kv2 as any], doStub as any, null as any);

		await svc.delete('user2', 'exp2');

		const v1 = JSON.parse(kv1.storage.get('expense:user2:exp2') ?? '{}');
		const v2 = JSON.parse(kv2.storage.get('expense:user2:exp2') ?? '{}');

		expect(v1.deleted).toBe(true);
		expect(v2.deleted).toBe(true);
	});

	it('list merges KV-only entries from multiple KVs', async () => {
		const kv1 = new MockKV();
		const kv2 = new MockKV();
		const doStub = new MockDOStub();

		await kv1.put(
			'expense:user3:expA',
			JSON.stringify({
				id: 'expA',
				userId: 'user3',
				date: '2025-01-01',
				amount: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);
		await kv2.put(
			'expense:user3:expB',
			JSON.stringify({
				id: 'expB',
				userId: 'user3',
				date: '2025-01-02',
				amount: 2,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);

		const svc = makeExpenseService([kv1 as any, kv2 as any], doStub as any);

		const results = await svc.list('user3');
		const ids = results.map((r) => r.id).sort();
		expect(ids).toEqual(['expA', 'expB']);
	});
});
