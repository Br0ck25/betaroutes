import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeTripService } from '$lib/server/tripService';

describe('Trip trash behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('delete stores original in main logs KV and marks trip deleted', async () => {
		const kv = platform.env['BETA_LOGS_KV'] as any;
		const svc = makeTripService(
			kv,
			undefined,
			platform.env['BETA_PLACES_KV'] as any,
			platform.env['TRIP_INDEX_DO'] as any,
			platform.env['TRIP_INDEX_DO'] as any
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
		expect(list.find((t) => t.id === id)).toBeTruthy();

		// Restore
		await svc.restore(userId, id);

		const afterTrip = JSON.parse(await kv.get(`trip:${userId}:${id}`));
		expect(afterTrip.deleted).toBe(undefined);
		expect(afterTrip.title).toBe('to trash');
	});
});
