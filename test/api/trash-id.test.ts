import { describe, it, expect } from 'vitest';
import { POST } from '../../src/routes/api/trash/[id]/+server';

function makeKV(initial: Record<string, string | undefined> = {}) {
	const store: Record<string, string> = { ...initial };
	return {
		_store: store,
		get: async (k: string) => store[k] ?? null,
		put: async (k: string, v: string) => {
			store[k] = v;
			return undefined;
		},
		list: async ({ prefix }: { prefix?: string }) => {
			const keys = Object.keys(store)
				.filter((k) => (prefix ? k.startsWith(prefix) : true))
				.map((name) => ({ name }));
			return { keys, list_complete: true, cursor: undefined };
		}
	};
}

function makeDO() {
	return {
		idFromName: (_: string) => 'stub-id',
		get: (_: string) => ({ fetch: async () => ({ ok: true, json: async () => ({ trips: [] }) }) })
	};
}

describe('API /api/trash/[id] POST restore (safety & mileage)', () => {
	it('returns 409 if parent trip is deleted', async () => {
		const mileageKV = makeKV({
			'mileage:u1:m1': JSON.stringify({
				id: 'm1',
				deleted: true,
				backup: { id: 'm1', tripId: 't1', miles: 5 }
			})
		});
		const logsKV = makeKV({
			'trip:u1:t1': JSON.stringify({
				id: 't1',
				deleted: true,
				userId: 'u1',
				createdAt: '2020-01-01'
			})
		});

		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'm1' },
			platform: {
				env: { BETA_MILEAGE_KV: mileageKV, BETA_LOGS_KV: logsKV, TRIP_INDEX_DO: makeDO() }
			},
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(409);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('Cannot restore mileage: parent trip is deleted');
	});

	it('returns 409 if another active mileage exists for same trip', async () => {
		const mileageKV = makeKV({
			'mileage:u1:m1': JSON.stringify({
				id: 'm1',
				deleted: true,
				backup: { id: 'm1', tripId: 't1', miles: 5 }
			}),
			'mileage:u1:m2': JSON.stringify({ id: 'm2', tripId: 't1', miles: 11 })
		});
		const logsKV = makeKV({
			'trip:u1:t1': JSON.stringify({
				id: 't1',
				deleted: false,
				userId: 'u1',
				createdAt: '2020-01-01'
			})
		});

		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'm1' },
			platform: {
				env: { BETA_MILEAGE_KV: mileageKV, BETA_LOGS_KV: logsKV, TRIP_INDEX_DO: makeDO() }
			},
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(409);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('another active mileage log exists');
	});

	it('successfully restores mileage and syncs trip totalMiles', async () => {
		const mileageKV = makeKV({
			'mileage:u1:m1': JSON.stringify({
				id: 'm1',
				deleted: true,
				backup: { id: 'm1', tripId: 't1', miles: 42 }
			})
		});
		const logsKV = makeKV({
			'trip:u1:t1': JSON.stringify({
				id: 't1',
				deleted: false,
				userId: 'u1',
				createdAt: '2020-01-01'
			})
		});

		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'm1' },
			platform: {
				env: { BETA_MILEAGE_KV: mileageKV, BETA_LOGS_KV: logsKV, TRIP_INDEX_DO: makeDO() }
			},
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(200);
		// Inspect that trip value in logsKV was updated with totalMiles
		const updated = JSON.parse((logsKV as any)._store['trip:u1:t1']);
		expect(updated.totalMiles).toBe(42);
	});

	it('returns 403 if restored trip userId does not match requester', async () => {
		// Tombstone's backup has userId 'u2' but key belongs to 'u1'
		const logsKV = makeKV({
			'trip:u1:t1': JSON.stringify({ id: 't1', deleted: true, backup: { id: 't1', userId: 'u2' } })
		});

		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 't1' },
			platform: { env: { BETA_LOGS_KV: logsKV, TRIP_INDEX_DO: makeDO() } },
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(403);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('Forbidden');
	});

	it('returns 404 when item is not found in any trash KVs', async () => {
		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'missing' },
			platform: { env: { TRIP_INDEX_DO: makeDO() } },
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(404);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('Item not found');
	});

	it('returns 409 when trip tombstone exists but is not deleted (invalid restore state)', async () => {
		const logsKV = makeKV({
			'trip:u1:t1': JSON.stringify({ id: 't1', deleted: false, userId: 'u1' })
		});

		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 't1' },
			platform: { env: { BETA_LOGS_KV: logsKV, TRIP_INDEX_DO: makeDO() } },
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(409);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('not deleted');
	});

	it('returns 409 when expense tombstone lacks backup data', async () => {
		const expenseKV = makeKV({ 'expense:u1:e2': JSON.stringify({ id: 'e2', deleted: true }) });
		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'e2' },
			platform: { env: { BETA_EXPENSES_KV: expenseKV, TRIP_INDEX_DO: makeDO() } },
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(409);
		const body = JSON.parse(await res.text());
		expect(String(body.error)).toContain('Backup data not found');
	});

	it('successfully restores an expense record', async () => {
		const expenseKV = makeKV({
			'expense:u1:e1': JSON.stringify({
				id: 'e1',
				deleted: true,
				backup: { id: 'e1', userId: 'u1', amount: 10, category: 'fuel', createdAt: '2020-01-01' }
			})
		});
		const event: any = {
			locals: { user: { id: 'u1' } },
			params: { id: 'e1' },
			platform: { env: { BETA_EXPENSES_KV: expenseKV, TRIP_INDEX_DO: makeDO() } },
			url: new URL('http://localhost')
		};

		const res = await POST(event);
		expect(res.status).toBe(200);
		const restored = JSON.parse((expenseKV as any)._store['expense:u1:e1']);
		expect(restored.deleted).toBeUndefined();
		expect(restored.amount).toBe(10);
	});
});
