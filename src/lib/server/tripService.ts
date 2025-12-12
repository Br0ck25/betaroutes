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

function indexKeyForUser(userId: string) {
  return `index:trips:${userId}`;
}

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined,
  placesKV: KVNamespace | undefined
) {
  
  // [!code changed] Updated to cache Lat/Lng
  async function cacheAddressesFromTrip(trip: TripRecord) {
    if (!placesKV) return;
    
    // Map address string -> Data object (to handle duplicates but keep best data)
    const addressData = new Map<string, { lat?: number, lng?: number }>();
    
    // Helper to add to map
    const add = (addr?: string, loc?: { lat: number, lng: number }) => {
        if (!addr) return;
        const normalized = addr.toLowerCase().trim();
        // If we have new coordinates OR we don't have this address yet, update it
        if (!addressData.has(normalized) || loc) {
            addressData.set(normalized, loc || {});
        }
    };

    add(trip.startAddress, trip.startLocation);
    add(trip.endAddress, trip.endLocation);
    
    if (Array.isArray(trip.stops)) {
      trip.stops.forEach(s => add(s.address, s.location));
    }
    
    if (Array.isArray(trip.destinations)) {
      trip.destinations.forEach((d: any) => add(d.address, d.location));
    }

    // Save to KV
    for (const [addrKey, data] of addressData.entries()) {
       const payload: any = { 
         lastSeen: new Date().toISOString() 
       };

       // Store formatted address (key is normalized, so we might want pretty version if available)
       // For now, using key as address reference.
       payload.formatted_address = addrKey; 

       if (data.lat !== undefined && data.lng !== undefined) {
           payload.lat = data.lat;
           payload.lng = data.lng;
           
           // Only write to KV if we have useful data (coords)
           await placesKV.put(addrKey, JSON.stringify(payload));
       }
    }
  }

  async function updateIndex(userId: string, trip: TripRecord, action: 'put' | 'delete') {
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      let trips: TripRecord[] = [];

      if (idxRaw) {
          trips = JSON.parse(idxRaw);
      } else {
          const prefix = prefixForUser(userId);
          const list = await kv.list({ prefix });
          for (const k of list.keys) {
             const raw = await kv.get(k.name);
             if (raw) trips.push(JSON.parse(raw));
          }
      }

      if (action === 'put') {
          const existingIdx = trips.findIndex(t => t.id === trip.id);
          if (existingIdx >= 0) {
              trips[existingIdx] = trip;
          } else {
              trips.push(trip);
          }
      } else if (action === 'delete') {
          trips = trips.filter(t => t.id !== trip.id);
      }

      trips.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      await kv.put(idxKey, JSON.stringify(trips));
  }

  return {
    async getMonthlyTripCount(userId: string): Promise<number> {
        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const key = `meta:user:${userId}:monthly_count:${monthKey}`;
        const val = await kv.get(key);
        return val ? parseInt(val, 10) : 0;
    },

    async incrementMonthlyTripCount(userId: string) {
        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const key = `meta:user:${userId}:monthly_count:${monthKey}`;
        
        const val = await kv.get(key);
        const current = val ? parseInt(val, 10) : 0;
        await kv.put(key, (current + 1).toString());
        return current + 1;
    },

    async list(userId: string): Promise<TripRecord[]> {
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      
      if (idxRaw) {
          return JSON.parse(idxRaw);
      }

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
      
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
      await updateIndex(trip.userId, trip, 'put');

      cacheAddressesFromTrip(trip).catch(e => {
        console.error('[TripService] Failed to cache addresses:', e);
      });
    },

    async delete(userId: string, tripId: string) {
      if (!trashKV) {
        const key = `trip:${userId}:${tripId}`;
        await kv.delete(key);
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
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); 

      trip.deletedAt = now.toISOString();

      const metadata: TrashMetadata = {
        deletedAt: now.toISOString(),
        deletedBy: userId,
        originalKey: key,
        expiresAt: expiresAt.toISOString()
      };

      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.put(
        trashKey, 
        JSON.stringify({ trip, metadata }),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );

      await kv.delete(key);
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