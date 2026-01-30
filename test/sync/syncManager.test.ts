import { beforeEach, test, expect, vi } from 'vitest';
import { getDB, clearDatabase } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';

// Mock csrfFetch to avoid network calls
vi.mock('$lib/utils/csrf', () => ({
  csrfFetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }))
}));

type MockNavigator = { onLine?: boolean };
type MockWindow = { addEventListener?: (...args: unknown[]) => void };

beforeEach(async () => {
  // Ensure a clean DB for each test
  await clearDatabase();

  // Ensure navigator.onLine is present and true for sync to run
  const g = globalThis as unknown as { navigator?: MockNavigator; window?: MockWindow };
  if (!g.navigator) g.navigator = { onLine: true };
  else g.navigator.onLine = true;

  // Provide minimal window event stubs if not present
  if (!g.window) g.window = { addEventListener: () => {} };
  else if (typeof g.window.addEventListener !== 'function') {
    g.window.addEventListener = () => {};
  }
});

test('delete queue item with undefined data does not throw and is removed from queue', async () => {
  // Insert a delete action into syncQueue with no `data` field
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  await tx.objectStore('syncQueue').add({
    action: 'delete',
    tripId: 'f1425583-cba5-4fc3-bd09-093d13815812',
    timestamp: Date.now(),
    retries: 0
  });
  await tx.done;

  // Force immediate sync - should process and remove the queued item without throwing
  await expect(syncManager.forceSyncNow()).resolves.not.toThrow();

  // Verify the queue is empty
  const db2 = await getDB();
  const pending = await db2.count('syncQueue');
  expect(pending).toBe(0);
});
