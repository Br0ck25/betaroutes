// src/lib/server/tripService.ts
import type { KVNamespace } from '@cloudflare/workers-types';

export type TripRecord = {
  id: string;
  userId: string;
  title?: string;
  stops?: any[];
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;  // Timestamp when moved to trash
  [key: string]: any;  // Allow other trip properties
};

export type TrashMetadata = {
  deletedAt: string;
  deletedBy: string;
  originalKey: string;
  expiresAt: string;  // When it will be permanently deleted
};

function prefixForUser(userId: string) {
  return `trip:${userId}:`;
}

function trashPrefixForUser(userId: string) {
  return `trash:${userId}:`;
}

export function makeTripService(
  kv: KVNamespace | undefined,
  trashKV: KVNamespace | undefined
) {
  if (!kv) {
    throw new Error('BETA_LOGS_KV not bound');
  }

  return {
    /**
     * List all active (non-deleted) trips for a user
     */
    async list(userId: string): Promise<TripRecord[]> {
      const prefix = prefixForUser(userId);
      const list = await kv.list({ prefix });
      const keys = list.keys || [];
      const out: TripRecord[] = [];
      
      for (const k of keys) {
        try {
          const raw = await kv.get(k.name);
          if (!raw) continue;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          out.push(parsed as TripRecord);
        } catch (e) {
          console.error('tripService: failed to read', k.name, e);
        }
      }
      
      // Sort by createdAt descending (newest first)
      out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return out;
    },

    /**
     * Get a single trip by ID
     */
    async get(userId: string, tripId: string): Promise<TripRecord | null> {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },

    /**
     * Create or update a trip
     */
    async put(record: TripRecord): Promise<void> {
      const key = `trip:${record.userId}:${record.id}`;
      record.updatedAt = new Date().toISOString();
      await kv.put(key, JSON.stringify(record));
    },

    /**
     * Soft delete - Move trip to trash with 30-day expiration
     */
    async delete(userId: string, tripId: string): Promise<void> {
      if (!trashKV) {
        // If no trash KV, do hard delete
        const key = `trip:${userId}:${tripId}`;
        await kv.delete(key);
        return;
      }

      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      
      if (!raw) {
        throw new Error('Trip not found');
      }

      const trip = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Add deletion metadata
      trip.deletedAt = now.toISOString();

      const metadata: TrashMetadata = {
        deletedAt: now.toISOString(),
        deletedBy: userId,
        originalKey: key,
        expiresAt: expiresAt.toISOString()
      };

      // Move to trash KV with metadata and 30-day expiration
      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.put(
        trashKey, 
        JSON.stringify({ trip, metadata }),
        {
          expirationTtl: 30 * 24 * 60 * 60  // 30 days in seconds
        }
      );

      // Remove from active trips
      await kv.delete(key);
    },

    /**
     * Permanently delete a trip from trash (cannot be restored)
     */
    async permanentDelete(userId: string, tripId: string): Promise<void> {
      if (!trashKV) {
        throw new Error('Trash KV not available');
      }

      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.delete(trashKey);
    },

    /**
     * Restore a trip from trash back to active trips
     */
    async restore(userId: string, tripId: string): Promise<TripRecord> {
      if (!trashKV) {
        throw new Error('Trash KV not available');
      }

      const trashKey = `trash:${userId}:${tripId}`;
      const raw = await trashKV.get(trashKey);

      if (!raw) {
        throw new Error('Trip not found in trash');
      }

      const { trip, metadata } = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Remove deletion timestamp
      delete trip.deletedAt;
      trip.updatedAt = new Date().toISOString();

      // Restore to active trips
      const activeKey = `trip:${userId}:${tripId}`;
      await kv.put(activeKey, JSON.stringify(trip));

      // Remove from trash
      await trashKV.delete(trashKey);

      return trip;
    },

    /**
     * List all trips in trash for a user
     */
    async listTrash(userId: string): Promise<Array<TripRecord & { metadata: TrashMetadata }>> {
      if (!trashKV) {
        return [];
      }

      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      const keys = list.keys || [];
      const out: Array<TripRecord & { metadata: TrashMetadata }> = [];

      for (const k of keys) {
        try {
          const raw = await trashKV.get(k.name);
          if (!raw) continue;
          const { trip, metadata } = typeof raw === 'string' ? JSON.parse(raw) : raw;
          out.push({ ...trip, metadata });
        } catch (e) {
          console.error('tripService: failed to read trash item', k.name, e);
        }
      }

      // Sort by deletedAt descending (most recently deleted first)
      out.sort((a, b) => 
        (b.metadata.deletedAt || '').localeCompare(a.metadata.deletedAt || '')
      );

      return out;
    },

    /**
     * Empty entire trash for a user (permanently delete all)
     */
    async emptyTrash(userId: string): Promise<number> {
      if (!trashKV) {
        throw new Error('Trash KV not available');
      }

      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      const keys = list.keys || [];

      let count = 0;
      for (const k of keys) {
        await trashKV.delete(k.name);
        count++;
      }

      return count;
    },

    /**
     * Get count of items in trash for a user
     */
    async getTrashCount(userId: string): Promise<number> {
      if (!trashKV) {
        return 0;
      }

      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      return list.keys?.length || 0;
    },

    /**
     * Increment/decrement user's trip counter
     */
    async incrementUserCounter(userId: string, amount = 1) {
      const metaKey = `meta:user:${userId}:trip_count`;
      try {
        const raw = await kv.get(metaKey);
        const cur = raw ? parseInt(String(raw), 10) || 0 : 0;
        const next = Math.max(0, cur + amount);  // Prevent negative counts
        await kv.put(metaKey, String(next));
        return next;
      } catch (e) {
        console.error('incrementUserCounter failed', e);
        return null;
      }
    },

    /**
     * Get user's trip count
     */
    async getUserTripCount(userId: string) {
      const metaKey = `meta:user:${userId}:trip_count`;
      const raw = await kv.get(metaKey);
      return raw ? parseInt(String(raw), 10) || 0 : 0;
    }
  };
}
