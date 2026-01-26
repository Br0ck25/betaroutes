import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sync/syncManager', () => ({
	syncManager: { addToQueue: vi.fn(), registerStore: vi.fn() }
}));

// Mock DB so trips store reads/writes succeed
vi.mock('$lib/db/indexedDB', () => ({
	getMileageStoreName: (_db: unknown) => 'mileage',
	getDB: async () => {
		return {
			transaction: (_stores: string | string[], _mode: string) => {
				return {
					objectStore: (name: string) => {
						if (name === 'trips') {
							return {
								get: async (id: string) =>
									id === 'trip-123'
										? { id: 'trip-123', userId: 'u1', totalMiles: 40, date: '2026-01-01' }
										: null,
								put: async (_record: unknown) => {}
							};
						}
						if (name === 'mileage') {
							return {
								get: async (_id: string) => null,
								index: (_: string) => ({
									getAll: async (userId: string) => [
										{ id: 'm1', userId, tripId: 'trip-123', miles: 40 }
									]
								})
							};
						}
						throw new Error('Unexpected store: ' + name);
					},
					done: Promise.resolve()
				};
			}
		};
	}
}));

// Mock mileage store module to spy on update/create
const updateMileageSpy = vi.fn();
const createMileageSpy = vi.fn();
vi.mock('$lib/stores/mileage', () => ({
	mileage: {
		get: async (_id: string, _userId: string) => null,
		findByTripId: async (tripId: string, userId: string) => ({
			id: 'm1',
			tripId,
			userId,
			miles: 40
		}),
		updateMileage: updateMileageSpy,
		create: createMileageSpy
	}
}));

import { trips } from './trips';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('trips store - updateTrip mileage mirroring', () => {
	it('updates linked mileage record even when mileage id differs from trip id', async () => {
		await trips.updateTrip('trip-123', { totalMiles: 55 }, 'u1');
		expect(updateMileageSpy).toHaveBeenCalledWith('m1', { miles: 55 }, 'u1');
		// Should not have created a new mileage record
		expect(createMileageSpy).not.toHaveBeenCalled();
	});
});
