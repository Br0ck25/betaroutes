import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearDatabase, getDB } from '$lib/db/indexedDB';
import { trash } from './trash';

describe('Trash reconciliation (safety)', () => {
	beforeEach(async () => {
		await clearDatabase();
	});

	it('a millage tombstone does not delete a trip with the same id', async () => {
		const userId = 'u-trash-safety';
		const db = await getDB();

		// Seed a trip record
		const tripId = 'trip-keep-1';
		await db
			.transaction('trips', 'readwrite')
			.objectStore('trips')
			.put({
				id: tripId,
				userId,
				totalMiles: 123,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				syncStatus: 'synced'
			} as any);

		// Insert a LOCAL tombstone that represents a millage deletion (legacy/mismatch case)
		const now = new Date();
		const trashItem = {
			id: tripId,
			userId,
			recordType: 'millage',
			deletedAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
			originalKey: `millage:${userId}:${tripId}`,
			syncStatus: 'synced'
		};
		await db
			.transaction('trash', 'readwrite')
			.objectStore('trash')
			.put(trashItem as any);

		// Mock network: return empty cloud trash so local cleanup runs
		const realFetch = globalThis.fetch;
		(globalThis as any).fetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify([]), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);

		try {
			await trash.syncFromCloud(userId);

			// Trip must still exist
			const tx = db.transaction('trips', 'readonly');
			const trip = await tx.objectStore('trips').get(tripId);
			await tx.done;
			expect(trip).toBeTruthy();
			expect(trip?.totalMiles).toBe(123);
		} finally {
			(globalThis as any).fetch = realFetch;
		}
	});
});
