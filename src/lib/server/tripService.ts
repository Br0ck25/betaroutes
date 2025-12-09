// src/lib/server/tripService.ts
import type { KVNamespace } from '@cloudflare/workers-types';

export type Stop = {
  id: string;
  address: string;
  notes?: string;
  earnings?: number;
  order: number;
  [key: string]: any;
};

export type TripRecord = {
  id: string;
  userId: string;
  title?: string;
  stops?: Stop[];
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  [key: string]: any;
};

export type TrashMetadata = {
  deletedAt: string;
  deletedBy: string;
  originalKey: string;
  expiresAt: string;
};

export type TrashItem = TripRecord & {
  metadata: TrashMetadata;
};

function prefixForUser(userId: string) {
  return `trip:${userId}:`;
}

function trashPrefixForUser(userId: string) {
  return `trash:${userId}:`;
}

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined
) {
  return {
    async list(userId: string): Promise<TripRecord[]> {
      const prefix = prefixForUser(userId);
      const list = await kv.list({ prefix });
      const out: TripRecord[] = [];

      for (const k of list.keys) {
        const raw = await kv.get(k.name);
        if (!raw) continue;
        const t = JSON.parse(raw);
        out.push(t);
      }

      out.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      return out;
    },

    async get(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) as TripRecord : null;
    },

    async put(trip: TripRecord) {
      trip.updatedAt = new Date().toISOString();
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
    },

    /**
     * Soft delete - Move trip to trash with 30-day expiration
     */
    async delete(userId: string, tripId: string) {
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

      const trip = JSON.parse(raw);
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

    async listTrash(userId: string): Promise<TrashItem[]> {
      if (!trashKV) return [];
      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      const out: TrashItem[] = [];

      for (const k of list.keys) {
        const raw = await trashKV.get(k.name);
        if (!raw) continue;
        const { trip, metadata } = JSON.parse(raw);
        out.push({ ...trip, metadata });
      }

      out.sort((a,b)=>b.metadata.deletedAt.localeCompare(a.metadata.deletedAt));
      return out;
    },

    async emptyTrash(userId: string) {
      if (!trashKV) return 0;
      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      let count = 0;

      for (const k of list.keys) {
        await trashKV.delete(k.name);
        count++;
      }

      return count;
    },

    /**
     * Restore a trip from trash back to active trips
     */
    async restore(userId: string, tripId: string) {
      if (!trashKV) {
        throw new Error('Trash KV not available');
      }

      const trashKey = `trash:${userId}:${tripId}`;
      const raw = await trashKV.get(trashKey);

      if (!raw) {
        throw new Error('Trip not found in trash');
      }

      const { trip, metadata } = JSON.parse(raw);

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
     * Permanently delete a trip from trash (cannot be restored)
     */
    async permanentDelete(userId: string, tripId: string) {
      if (!trashKV) {
        throw new Error('Trash KV not available');
      }

      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.delete(trashKey);
    },

    async incrementUserCounter(userId: string, amt = 1) {
      const key = `meta:user:${userId}:trip_count`;
      const raw = await kv.get(key);
      const cur = raw ? parseInt(raw,10) : 0;
      const next = Math.max(0, cur + amt);

      await kv.put(key, String(next));
      return next;
    }
  };
}