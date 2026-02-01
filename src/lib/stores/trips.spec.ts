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
                put: async (_record: unknown) => {},
                delete: async (_id: string) => {},
                index: (_: string) => ({
                  getAll: async (userId: string) =>
                    userId === 'temp-1'
                      ? [
                          {
                            id: 't-temp-1',
                            userId: 'temp-1',
                            totalMiles: 10,
                            date: '2026-01-01'
                          }
                        ]
                      : []
                })
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
            if (name === 'trash') {
              return {
                put: async (_item: unknown) => {},
                getAll: async () => [],
                index: (_: string) => ({ getAll: async () => [] })
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

// Mock authenticated user store
vi.mock('$lib/stores/auth', () => ({
  user: {
    subscribe: (cb: (v: { id: string }) => void) => {
      cb({ id: 'u1' });
      return () => {};
    }
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

  it('adds userId when deleting a trip (queue)', async () => {
    // deleteTrip will remove trip and enqueue delete for same authenticated user
    try {
      await trips.deleteTrip('trip-123', 'u1');
    } catch (err) {
      // Print error for debugging

      console.error('DELETE_TRIP_ERROR', err);
      throw err;
    }
    const { syncManager } = await import('$lib/sync/syncManager');
    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', tripId: 'trip-123', userId: 'u1' })
    );
  });

  it('adds userId when migrating offline trips to real user', async () => {
    // migrateOfflineTrips should enqueue a create with the real user id
    await trips.migrateOfflineTrips('temp-1', 'real-1');
    const { syncManager } = await import('$lib/sync/syncManager');
    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', userId: 'real-1' })
    );
  });
});
