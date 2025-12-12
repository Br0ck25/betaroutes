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

// [!code ++] NEW: Helper for the single index key
function indexKeyForUser(userId: string) {
  return `index:trips:${userId}`;
}

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined,
  placesKV: KVNamespace | undefined
) {
  
  // Helper to save addresses to the Places KV in the background
  async function cacheAddressesFromTrip(trip: TripRecord) {
    if (!placesKV) return;
    
    const addresses = new Set<string>();
    
    if (trip.startAddress) addresses.add(trip.startAddress);
    if (trip.endAddress) addresses.add(trip.endAddress);
    
    if (Array.isArray(trip.stops)) {
      trip.stops.forEach(s => s.address && addresses.add(s.address));
    }
    
    if (Array.isArray(trip.destinations)) {
      trip.destinations.forEach((d: any) => d.address && addresses.add(d.address));
    }

    for (const addr of addresses) {
       const key = addr.toLowerCase().trim();
       await placesKV.put(key, JSON.stringify({ 
         formatted_address: addr,
         lastSeen: new Date().toISOString()
       }));
    }
  }

  // [!code ++] NEW: Internal helper to keep the index in sync
  async function updateIndex(userId: string, trip: TripRecord, action: 'put' | 'delete') {
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      let trips: TripRecord[] = [];

      if (idxRaw) {
          trips = JSON.parse(idxRaw);
      } else {
          // Fallback: If index is missing, rebuild it from a full scan
          const prefix = prefixForUser(userId);
          const list = await kv.list({ prefix });
          for (const k of list.keys) {
             const raw = await kv.get(k.name);
             if (raw) trips.push(JSON.parse(raw));
          }
      }

      if (action === 'put') {
          // Update or Add
          const existingIdx = trips.findIndex(t => t.id === trip.id);
          if (existingIdx >= 0) {
              trips[existingIdx] = trip;
          } else {
              trips.push(trip);
          }
      } else if (action === 'delete') {
          // Remove
          trips = trips.filter(t => t.id !== trip.id);
      }

      // Ensure consistent sort order
      trips.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      
      // Save the single index key
      await kv.put(idxKey, JSON.stringify(trips));
  }

  return {
    async list(userId: string): Promise<TripRecord[]> {
      // [!code ++] 1. Try to fetch from the fast Index key first
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      
      if (idxRaw) {
          return JSON.parse(idxRaw);
      }

      // [!code ++] 2. Fallback: Slow "N+1" Scan (Migration Path)
      // This runs ONLY if the index doesn't exist yet (e.g. first load after update)
      const prefix = prefixForUser(userId);
      const list = await kv.list({ prefix });
      const out: TripRecord[] = [];

      for (const k of list.keys) {
        const raw = await kv.get(k.name);
        if (!raw) continue;
        const t = JSON.parse(raw);
        out.push(t);
      }

      out.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      
      // [!code ++] 3. Self-Heal: Create the index now so next time is fast
      if (out.length > 0) {
          await kv.put(idxKey, JSON.stringify(out));
      }
      
      return out;
    },

    async get(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) as TripRecord : null;
    },

    async put(trip: TripRecord) {
      trip.updatedAt = new Date().toISOString();
      
      // 1. Save individual trip record (Source of Truth)
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));

      // [!code ++] 2. Update the Index
      await updateIndex(trip.userId, trip, 'put');

      // 3. Save addresses to Places KV (Fire and forget)
      cacheAddressesFromTrip(trip).catch(e => {
        console.error('[TripService] Failed to cache addresses:', e);
      });
    },

    async delete(userId: string, tripId: string) {
      if (!trashKV) {
        // Hard delete
        const key = `trip:${userId}:${tripId}`;
        await kv.delete(key);
        // [!code ++] Update Index
        await updateIndex(userId, { id: tripId } as TripRecord, 'delete');
        return;
      }

      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      
      if (!raw) {
        throw new Error('Trip not found');
      }

      const trip = JSON.parse(raw);
      const now = new Date();
      // 30 day expiration
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); 

      trip.deletedAt = now.toISOString();

      const metadata: TrashMetadata = {
        deletedAt: now.toISOString(),
        deletedBy: userId,
        originalKey: key,
        expiresAt: expiresAt.toISOString()
      };

      // Move to trash
      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.put(
        trashKey, 
        JSON.stringify({ trip, metadata }),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );

      // Remove from active trips
      await kv.delete(key);
      
      // [!code ++] Update Index
      await updateIndex(userId, trip, 'delete');
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

      delete trip.deletedAt;
      trip.updatedAt = new Date().toISOString();

      const activeKey = `trip:${userId}:${tripId}`;
      await kv.put(activeKey, JSON.stringify(trip));

      // [!code ++] Restore to Index
      await updateIndex(userId, trip, 'put');

      await trashKV.delete(trashKey);

      return trip;
    },

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