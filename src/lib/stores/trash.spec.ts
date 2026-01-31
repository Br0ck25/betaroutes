import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sync/syncManager', () => ({
  syncManager: { addToQueue: vi.fn(), registerStore: vi.fn() }
}));

// Minimal DB mock for trash operations
vi.mock('$lib/db/indexedDB', () => ({
  getMileageStoreName: (_db: unknown) => 'mileage',
  getDB: async () => {
    return {
      transaction: (_stores: string | string[], _mode: string) => {
        return {
          objectStore: (name: string) => {
            if (name === 'trash') {
              return {
                // For read operations
                index: (_: string) => ({
                  getAll: async (userId: string) => [{ id: 'trip:1', userId, recordType: 'trip' }]
                }),
                get: async (id: string) => ({ id, userId: 'u1', recordType: 'trip', backups: {} }),
                delete: async (_id: string) => {},
                put: async (_item: unknown) => {},
                getAll: async () => []
              };
            }
            if (name === 'trips') {
              return {
                put: async (_t: unknown) => {},
                get: async (_id: string) => null
              };
            }
            if (name === 'expenses') {
              return { put: async (_t: unknown) => {} };
            }
            const mileageStoreName = 'mileage';
            if (name === mileageStoreName) {
              return { put: async (_t: unknown) => {} };
            }
            throw new Error('Unexpected store: ' + name);
          },
          done: Promise.resolve()
        };
      }
    };
  }
}));

import { trash } from './trash';

beforeEach(() => vi.clearAllMocks());

describe('trash store - sync queue userId enforcement', () => {
  it('emptyTrash enqueues permanentDelete with provided userId', async () => {
    const count = await trash.emptyTrash('u1');
    expect(count).toBeGreaterThanOrEqual(0);
    const { syncManager } = await import('$lib/sync/syncManager');
    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'permanentDelete', tripId: '1', userId: 'u1' })
    );
  });

  it('permanentDelete enqueues with item.userId when available', async () => {
    await trash.permanentDelete('trip:1');
    const { syncManager } = await import('$lib/sync/syncManager');
    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'permanentDelete', tripId: '1', userId: 'u1' })
    );
  });

  it('restore enqueues restore with provided userId', async () => {
    const restored = await trash.restore('trip:1', 'u1', 'trip');
    expect(restored).toBeTruthy();
    const { syncManager } = await import('$lib/sync/syncManager');
    expect(syncManager.addToQueue).toHaveBeenCalled();
    const calls = (syncManager.addToQueue as any).mock.calls as Array<any>;
    const foundRestore = calls.some(
      (c) =>
        c &&
        c[0] &&
        c[0].action === 'restore' &&
        String(c[0].tripId) === '1' &&
        c[0].userId === 'u1'
    );
    expect(foundRestore).toBe(true);
  });
});
