import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import type { AppDB } from '$lib/db/indexedDB';

vi.mock('$lib/sync/syncManager', () => ({
	syncManager: { addToQueue: vi.fn(), registerStore: vi.fn() }
}));

// Mock the IndexedDB accessor
const mockMileageRec = {
	id: 'm1',
	userId: 'u1',
	tripId: 'trip-123',
	miles: 42,
	vehicle: 'van',
	date: '2026-01-01T00:00:00.000Z',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

const mockTrip = {
	id: 'trip-123',
	userId: 'u1',
	totalMiles: 42,
	fuelCost: 10.5,
	updatedAt: new Date().toISOString()
};

const mockMileageRecLegacy = {
	id: 'trip-legacy',
	userId: 'u1',
	miles: 99,
	vehicle: 'truck',
	date: '2026-01-02T00:00:00.000Z',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString()
};

const mockTripLegacy = {
	id: 'trip-legacy',
	userId: 'u1',
	totalMiles: 100,
	fuelCost: 25,
	updatedAt: new Date().toISOString()
};

const tripStorePut = vi.fn();

vi.mock('$lib/db/indexedDB', () => ({
	getMileageStoreName: (_db: IDBPDatabase<AppDB>) => 'mileage',
	getDB: async () => {
		return {
			transaction: (_stores: string | string[], _mode: string) => {
				return {
					objectStore: (name: string) => {
						if (name === 'mileage') {
							return {
								get: async (id: string) =>
									id === 'm1' ? mockMileageRec : id === 'trip-legacy' ? mockMileageRecLegacy : null,
								delete: async (_id: string) => {},
								put: async (_: Record<string, unknown>) => {}
							};
						}
						if (name === 'trash') {
							return {
								put: async (_: Record<string, unknown>) => {}
							};
						}
						if (name === 'trips') {
							return {
								get: async (id: string) =>
									id === 'trip-123' ? mockTrip : id === 'trip-legacy' ? mockTripLegacy : null,
								put: tripStorePut
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

import { mileage } from './mileage';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('mileage store - deleteMileage', () => {
	it('zeros linked trip when mileage is moved to trash', async () => {
		// call the store method
		await mileage.deleteMileage('m1', 'u1');

		// trip store should be patched
		expect(tripStorePut).toHaveBeenCalled();
		const patched = tripStorePut.mock.calls[0]![0] as TripRecord;
		expect(patched.id).toBe('trip-123');
		expect(patched.totalMiles).toBe(0);
		expect(patched.fuelCost).toBe(0);

		// sync queue should include an update for the trip
		expect(syncManager.addToQueue).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'update', tripId: 'trip-123', data: expect.any(Object) })
		);
	});

	it('zeros trip when mileage id matches trip id (legacy)', async () => {
		await mileage.deleteMileage('trip-legacy', 'u1');

		expect(tripStorePut).toHaveBeenCalled();
		const patched = tripStorePut.mock.calls[0]![0] as TripRecord;
		expect(patched.id).toBe('trip-legacy');
		expect(patched.totalMiles).toBe(0);
		expect(patched.fuelCost).toBe(0);

		expect(syncManager.addToQueue).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'update', tripId: 'trip-legacy', data: expect.any(Object) })
		);
	});
});
