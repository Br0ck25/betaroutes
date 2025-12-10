// src/lib/server/tripService.ts
import type { KVNamespace } from '@cloudflare/workers-types';

export type TripRecord = {
  id: string;
  userId: string;
  [key: string]: any;
};

// Enforce Key Format: trip:James:UUID
function getTripKey(userId: string, tripId: string) {
  return `trip:${userId}:${tripId}`;
}

// Enforce Trash Key Format: trash:James:UUID
function getTrashKey(userId: string, tripId: string) {
  return `trash:${userId}:${tripId}`;
}

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined
) {
  return {
    async list(userId: string): Promise<TripRecord[]> {
      const prefix = `trip:${userId}:`;
      const list = await kv.list({ prefix });
      const out: TripRecord[] = [];

      for (const k of list.keys) {
        const raw = await kv.get(k.name);
        if (raw) {
            try { out.push(JSON.parse(raw)); } catch (e) {}
        }
      }
      return out;
    },

    async get(userId: string, tripId: string) {
      const key = getTripKey(userId, tripId);
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) : null;
    },

    async put(trip: TripRecord) {
      // Ensure we use the Name/ID provided in the trip object for the key
      const key = getTripKey(trip.userId, trip.id);
      trip.updatedAt = new Date().toISOString();
      await kv.put(key, JSON.stringify(trip));
    },

    /**
     * MOVE TO TRASH: Atomic-like operation
     * 1. Write to Trash KV
     * 2. Delete from Active KV
     */
    async delete(userId: string, tripId: string) {
      const activeKey = getTripKey(userId, tripId);
      
      if (!trashKV) {
        await kv.delete(activeKey); // Fallback if no trash KV
        return;
      }

      // 1. Fetch original data
      const raw = await kv.get(activeKey);
      if (!raw) return; // Already deleted or doesn't exist

      const trip = JSON.parse(raw);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // 2. Prepare Trash Object
      const trashItem = {
        ...trip,
        deletedAt: now.toISOString(),
        deletedBy: userId,
        expiresAt: expiresAt.toISOString(),
        originalKey: activeKey
      };

      // 3. Write to Trash KV (BETA_LOGS_TRASH_KV)
      const trashKey = getTrashKey(userId, tripId);
      await trashKV.put(trashKey, JSON.stringify(trashItem), { expirationTtl: 2592000 }); // 30 days in seconds

      // 4. Delete from Active KV (BETA_LOGS_KV)
      await kv.delete(activeKey);
    },

    async listTrash(userId: string) {
      if (!trashKV) return [];
      const prefix = `trash:${userId}:`;
      const list = await trashKV.list({ prefix });
      const out = [];
      for (const k of list.keys) {
        const raw = await trashKV.get(k.name);
        if (raw) {
            try { out.push(JSON.parse(raw)); } catch (e) {}
        }
      }
      return out;
    },

    async restore(userId: string, tripId: string) {
        if (!trashKV) throw new Error('No Trash KV');
        
        const trashKey = getTrashKey(userId, tripId);
        const raw = await trashKV.get(trashKey);
        if (!raw) throw new Error('Trip not found in trash');

        const item = JSON.parse(raw);
        
        // Clean up metadata
        delete item.deletedAt;
        delete item.deletedBy;
        delete item.expiresAt;
        delete item.originalKey;
        item.updatedAt = new Date().toISOString();

        // Write back to Active
        const activeKey = getTripKey(userId, tripId);
        await kv.put(activeKey, JSON.stringify(item));

        // Remove from Trash
        await trashKV.delete(trashKey);
        
        return item;
    },

    async permanentDelete(userId: string, tripId: string) {
        if (!trashKV) return;
        const trashKey = getTrashKey(userId, tripId);
        await trashKV.delete(trashKey);
    },
    
    // User Stat Counters (Helper)
    async incrementUserCounter(token: string, amt = 1) {
        if(!token) return;
        const key = `meta:user:${token}:trip_count`;
        const raw = await kv.get(key);
        const val = raw ? parseInt(raw) : 0;
        await kv.put(key, String(val + amt));
    }
  };
}