// src/lib/server/tripService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { generatePrefixKey, generatePlaceKey } from '$lib/utils/keys';

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
  
  // Updated to handle both Lat/Lng Caching AND Autocomplete Indexing
  async function indexTripData(trip: TripRecord) {
    if (!placesKV) return;
    
    // 1. Gather Unique Data
    // Map address string -> Data object (to handle duplicates but keep best data)
    const uniquePlaces = new Map<string, { lat?: number, lng?: number }>();
    
    const add = (addr?: string, loc?: { lat: number, lng: number }) => {
        if (!addr || addr.length < 3) return;
        const normalized = addr.toLowerCase().trim();
        // Update if we have new coordinates OR if it's a new address
        if (!uniquePlaces.has(normalized) || loc) {
            uniquePlaces.set(normalized, loc || {});
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

    // 2. Process KV Writes
    // We group these promises to run in parallel
    const writePromises: Promise<void>[] = [];

    for (const [addrKey, data] of uniquePlaces.entries()) {
       // --- A. Cache Place Details (Lat/Lng) ---
       // Used for optimizing route calculations later
       if (data.lat !== undefined && data.lng !== undefined) {
           // [!code fix] Use Hashed Key to prevent 512-byte limit errors on long inputs
           const safeKey = await generatePlaceKey(addrKey);

           const payload = { 
             lastSeen: new Date().toISOString(),
             formatted_address: addrKey, // Preserve original text for display/search
             lat: data.lat,
             lng: data.lng
           };
           writePromises.push(placesKV.put(safeKey, JSON.stringify(payload)));
       }

       // --- B. Update Autocomplete Prefix Index ---
       // Used for the frontend "Type-ahead" search
       const prefixKey = generatePrefixKey(addrKey);
       
       // Note: Read-Modify-Write inside a loop isn't atomic in KV, 
       // but acceptable for this eventual-consistency use case.
       const updatePrefixBucket = async () => {
           const existingList = await placesKV!.get(prefixKey, 'json') as string[] | null;
           const list = existingList || [];

           if (!list.includes(addrKey)) {
               list.push(addrKey);
               // Cap bucket size to 50 to prevent massive JSON blobs
               if (list.length > 50) list.shift();
               await placesKV!.put(prefixKey, JSON.stringify(list));
           }
       };
       writePromises.push(updatePrefixBucket());
    }

    await Promise.allSettled(writePromises);
  }

  async function updateIndex(userId: string, trip: TripRecord, action: 'put' | 'delete') {
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      let trips: TripRecord[] = [];

      if (idxRaw) {
          trips = JSON.parse(idxRaw);
      } else {
          // Fallback: Rebuild index from list if missing
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

      // Keep index sorted by date (newest first)
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
      
      // Fast path: Return cached index
      if (idxRaw) {
          return JSON.parse(idxRaw);
      }

      // Slow path: Rebuild index
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
      
      // Cache the result
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

      // Async caching/indexing - don't block main response
      indexTripData(trip).catch(e => {
        console.error('[TripService] Failed to index trip data:', e);
      });
    },

    async delete(userId: string, tripId: string) {
      if (!trashKV) {
        // Hard delete if no trash support
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
      // 30 Day soft delete policy
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
        { expirationTtl: 30 * 24 * 60 * 60 } // Cloudflare auto-delete
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