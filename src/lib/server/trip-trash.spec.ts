import { describe, it, expect, beforeEach } from 'vitest';
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeTripService } from '$lib/server/tripService';

describe('Trip trash behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('delete stores original in main logs KV and marks trip deleted', async () => {
		const kv = platform.env['BETA_LOGS_KV'] as unknown as KVNamespace;
		const svc = makeTripService(
			kv,
			undefined,
			platform.env['BETA_PLACES_KV'] as unknown as KVNamespace,
			platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace,
			platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace
		);

		const userId = 'trash_user';
		const id = 'trip-1';
		const now = new Date().toISOString();
		const trip = { id, userId, title: 'to trash', createdAt: now, updatedAt: now };

		await kv.put(`trip:${userId}:${id}`, JSON.stringify(trip));

		await svc.delete(userId, id);

		// Tombstone should exist in-place in the main KV
		const rawTrash = await kv.get(`trip:${userId}:${id}`);
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
		expect(found?.title || found?.startAddress || '').toBeTruthy();

		// Restore
		await svc.restore(userId, id);

		const afterTrip = JSON.parse(await kv.get(`trip:${userId}:${id}`));
		expect(afterTrip.deleted).toBe(undefined);
		expect(afterTrip.title).toBe('to trash');
	});
});
