import { describe, it, expect, vi } from 'vitest';
import { purgeExpiredTrash } from './trashPurge';

function makeMockKV(items: Record<string, any>) {
	return {
		_asyncKeys(): Array<{ name: string }> {
			return Object.keys(items).map((k) => ({ name: k }));
		},
		list: async ({ prefix }: any) => {
			const all = Object.keys(items)
				.filter((k) => k.startsWith(prefix))
				.map((n) => ({ name: n }));
			return { keys: all, list_complete: true };
		},
		get: async (name: string) => {
			return items[name] ? JSON.stringify(items[name]) : null;
		},
		delete: async (name: string) => {
			delete items[name];
		}
	};
}

describe('purgeExpiredTrash', () => {
	it('deletes only expired items and calls permanentDelete with correct ids', async () => {
		const now = Date.now();
		const past = new Date(now - 1000 * 60 * 60 * 24).toISOString();
		const future = new Date(now + 1000 * 60 * 60 * 24).toISOString();

		const items: Record<string, any> = {
			'trip:u1:t1': { id: 't1', userId: 'u1', deleted: true, metadata: { expiresAt: past } },
			'trip:u1:t2': { id: 't2', userId: 'u1', deleted: true, metadata: { expiresAt: future } },
			'mileage:u2:m1': { id: 'm1', userId: 'u2', deleted: true, metadata: { expiresAt: past } }
		};

		const kvMock = makeMockKV(items);

		const mockTripSvc = { permanentDelete: vi.fn(async (_u: string, _id: string) => {}) };
		const mockMileageSvc = { permanentDelete: vi.fn(async (_u: string, _id: string) => {}) };
		const env: Record<string, unknown> = {
			BETA_LOGS_KV: kvMock,
			BETA_MILEAGE_KV: kvMock
		};

		const res = await purgeExpiredTrash(env, {
			batchSize: 2,
			services: { tripSvc: mockTripSvc as any, mileageSvc: mockMileageSvc as any }
		});

		expect(res.deleted).toBe(2);
		expect(mockTripSvc.permanentDelete).toHaveBeenCalledWith('u1', 't1');
		expect(mockMileageSvc.permanentDelete).toHaveBeenCalledWith('u2', 'm1');
		expect(mockTripSvc.permanentDelete).not.toHaveBeenCalledWith('u1', 't2');
	});

	it('respects maxDeletes cap', async () => {
		const now = Date.now();
		const past = new Date(now - 1000 * 60 * 60 * 24).toISOString();
		const items: Record<string, any> = {};
		for (let i = 0; i < 5; i++) {
			items[`trip:uX:t${i}`] = {
				id: `t${i}`,
				userId: 'uX',
				deleted: true,
				metadata: { expiresAt: past }
			};
		}

		const kvMock = makeMockKV(items);
		const mockTripSvc = { permanentDelete: vi.fn(async () => {}) };
		const env: Record<string, unknown> = { BETA_LOGS_KV: kvMock };

		const res = await purgeExpiredTrash(env, {
			maxDeletes: 2,
			services: { tripSvc: mockTripSvc as any }
		});
		expect(res.deleted).toBe(2);
		expect(mockTripSvc.permanentDelete).toHaveBeenCalledTimes(2);
	});

	it('gracefully skips missing KV', async () => {
		const env: Record<string, unknown> = {}; // no KVs
		const res = await purgeExpiredTrash(env);
		expect(res.deleted).toBe(0);
		expect(res.checked).toBe(0);
	});
});
