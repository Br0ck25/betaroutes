import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/sync/syncManager', () => ({
  syncManager: { addToQueue: vi.fn(), registerStore: vi.fn() }
}));

vi.mock('$lib/db/indexedDB', () => ({
  getDB: async () => {
    return {
      transaction: (_stores: string | string[], _mode: string) => {
        return {
          objectStore: (name: string) => {
            if (name === 'expenses') {
              return {
                get: async (_id: string) => null,
                put: async (_record: unknown) => {}
              };
            }
            if (name === 'trash') {
              return {
                put: async (_r: unknown) => {},
                get: async (_id: string) => null
              };
            }
            return {
              index: (_: string) => ({ getAll: async (_userId: string) => [] })
            };
          },
          done: Promise.resolve()
        };
      }
    };
  }
}));

vi.mock('$lib/stores/auth', () => ({
  auth: writable({ user: { id: 'u1', plan: 'pro' } })
}));

import { syncManager } from '$lib/sync/syncManager';
import { expenses } from './expenses';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expenses store - sync queue includes userId', () => {
  it('adds userId to syncManager.addToQueue on create', async () => {
    await expenses.create({ amount: 12, category: 'fuel' }, 'u1');

    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'create' })
    );
    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ store: 'expenses' }) })
    );
  });

  it('adds userId to syncManager.addToQueue when record missing on delete', async () => {
    await expenses.deleteExpense('exp-missing', 'u1');

    expect(syncManager.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'delete' })
    );
  });
});
