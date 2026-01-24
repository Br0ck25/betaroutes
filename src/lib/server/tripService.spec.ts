/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { makeTripService } from './tripService';

function makeMockKV(map: Record<string, string>) {
	return {
		async list({ prefix }: { prefix: string }) {
			const keys = Object.keys(map)
				.filter((k) => k.startsWith(prefix))
				.map((name) => ({ name }));
			return { keys, list_complete: true };
		},
		async get(name: string) {
			return map[name] ?? null;
		}
	};
}

function makeFakeDO(down = true) {
	// When `down` true we return non-ok to force KV fallback during tests
	return {
		idFromName: (s: string) => s,
		get: () => ({
			fetch: async () => (down ? { ok: false, status: 500 } : { ok: true, json: async () => [] })
		})
	};
}

describe('TripService dual-read', () => {
	it('list() merges canonical and legacy prefixes and dedupes', async () => {
		const uuid = 'user-uuid-123';
		const username = 'Alice';

		const mockMap: Record<string, string> = {
			[`trip:${uuid}:t1`]: JSON.stringify({ id: 't1', userId: uuid, createdAt: '2025-01-01' }),
			[`trip:${username}:t2`]: JSON.stringify({
				id: 't2',
				userId: username,
				createdAt: '2025-02-01'
			})
		};

		const kv = makeMockKV(mockMap) as any;
		const svc = makeTripService(kv, undefined, undefined, makeFakeDO() as any, makeFakeDO() as any);

		const trips = await svc.list(uuid, {}, username);
		expect(trips.map((t) => t.id).sort()).toEqual(['t1', 't2']);
	});

	it('get() falls back to legacy and normalizes userId', async () => {
		const uuid = 'user-uuid-123';
		const username = 'Bob';
		const mockMap: Record<string, string> = {
			[`trip:${username}:legacy`]: JSON.stringify({
				id: 'legacy',
				userId: username,
				createdAt: '2024-12-01'
			})
		};

		const kv = makeMockKV(mockMap) as any;
		const svc = makeTripService(kv, undefined, undefined, makeFakeDO() as any, makeFakeDO() as any);

		const t = await svc.get(uuid, 'legacy', username);
		expect(t).toBeTruthy();
		expect(t?.id).toBe('legacy');
		expect(t?.userId).toBe(uuid); // normalized
	});
});
