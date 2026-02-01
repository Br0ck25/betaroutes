import type { TrashRecord } from '$lib/db/types';
import { getDB } from './indexedDB';

/**
 * Security wrapper: Get trash items for a specific user (server or client usage).
 * Enforces user-scoped retrieval and normalizes shapes before returning.
 */
export async function getTrashForUser(userId: string): Promise<TrashRecord[]> {
  if (!userId) return [];
  const db = await getDB();
  const tx = db.transaction('trash', 'readonly');
  const index = tx.objectStore('trash').index('userId');
  const items = (await index.getAll(userId)) as unknown[];

  // Normalize shapes: flatten data field if present
  const normalized: TrashRecord[] = items.map((item) => {
    const copy = { ...(item as Record<string, unknown>) } as Record<string, unknown>;
    if (copy.data && typeof copy.data === 'object') {
      const inner = copy.data as Record<string, unknown>;
      const merged = { ...inner, ...copy } as Record<string, unknown>;
      // remove nested data field safely
      if ('data' in merged) delete merged['data'];
      return merged as TrashRecord;
    }
    return copy as TrashRecord;
  });

  return normalized;
}
