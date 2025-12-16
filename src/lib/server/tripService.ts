// src/lib/server/tripService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
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

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined,
  placesKV: KVNamespace | undefined,
  tripIndexDO: DurableObjectNamespace
) {
  
  const getIndexStub = (userId: string) => {
    const id = tripIndexDO.idFromName(userId);
    return tripIndexDO.get(id);
  };

  const toSummary = (trip: TripRecord) => ({
      id: trip.id,
      userId: trip.userId,
      date: trip.date,
      title: trip.title,
      startAddress: trip.startAddress,
      endAddress: trip.endAddress,
      netProfit: trip.netProfit,
      totalMiles: trip.totalMiles,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt
  });

  async function indexTripData(trip: TripRecord) {
    if (!placesKV) return;
    
    const uniquePlaces = new Map<string, { lat?: number, lng?: number }>();
    
    const add = (addr?: string, loc?: { lat: number, lng: number }) => {
        if (!addr || addr.length < 3) return;
        const normalized = addr.toLowerCase().trim();
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

    const writePromises: Promise<void>[] = [];

    for (const [addrKey, data] of uniquePlaces.entries()) {
       if (data.lat !== undefined && data.lng !== undefined) {
           const safeKey = await generatePlaceKey(addrKey);
           const payload = { 
             lastSeen: new Date().toISOString(),
             formatted_address: addrKey,
             lat: data.lat,
             lng: data.lng
           };
           writePromises.push(placesKV.put(safeKey, JSON.stringify(payload)));
       }

       const prefixKey = generatePrefixKey(addrKey);
       
       const updatePrefixBucket = async () => {
           const existingList = await placesKV!.get(prefixKey, 'json') as string[] | null;
           const list = existingList || [];

           if (!list.includes(addrKey)) {
               list.push(addrKey);
               if (list.length > 50) list.shift();
               await placesKV!.put(prefixKey, JSON.stringify(list));
           }
       };
       writePromises.push(updatePrefixBucket());
    }

    await Promise.allSettled(writePromises);
  }

  return {
    async checkMonthlyQuota(userId: string, limit: number): Promise<{ allowed: boolean, count: number }> {
        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        const stub = getIndexStub(userId);
        
        const res = await stub.fetch('http://internal/billing/check-increment', {
            method: 'POST',
            body: JSON.stringify({ monthKey, limit })
        });
        
        if (!res.ok) {
            return { allowed: false, count: limit }; 
        }

        return await res.json() as { allowed: boolean, count: number };
    },

    async list(userId: string): Promise<TripRecord[]> {
      const stub = getIndexStub(userId);
      const res = await stub.fetch('http://internal/list');
      const data = await res.json() as any;

      if (data.needsMigration) {
          console.log(`[TripService] Migrating index for user ${userId} to Durable Object...`);
          
          const prefix = prefixForUser(userId);
          const list = await kv.list({ prefix });
          const out: TripRecord[] = [];

          for (const k of list.keys) {
            const raw = await kv.get(k.name);
            if (!raw) continue;
            const t = JSON.parse(raw);
            out.push(t);
          }
          
          const summaries = out.map(toSummary);
          await stub.fetch('http://internal/migrate', {
              method: 'POST',
              body: JSON.stringify(summaries)
          });

          out.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
          return out;
      }

      return data as TripRecord[];
    },

    async get(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) as TripRecord : null;
    },

    async put(trip: TripRecord) {
      trip.updatedAt = new Date().toISOString();
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
      
      const stub = getIndexStub(trip.userId);
      await stub.fetch('http://internal/put', {
          method: 'POST',
          body: JSON.stringify(toSummary(trip))
      });

      indexTripData(trip).catch(e => {
        console.error('[TripService] Failed to index trip data:', e);
      });
    },

    async delete(userId: string, tripId: string) {
      const stub = getIndexStub(userId);
      await stub.fetch('http://internal/delete', {
          method: 'POST',
          body: JSON.stringify({ id: tripId })
      });

      const date = new Date();
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      await stub.fetch('http://internal/billing/decrement', {
          method: 'POST',
          body: JSON.stringify({ monthKey })
      });

      if (!trashKV) {
        const key = `trip:${userId}:${tripId}`;
        await kv.delete(key);
        return;
      }

      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      if (!raw) return; 

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
      if (!trashKV) throw new Error('Trash KV not available');

      const trashKey = `trash:${userId}:${tripId}`;
      const raw = await trashKV.get(trashKey);
      if (!raw) throw new Error('Trip not found in trash');

      const { trip, metadata } = JSON.parse(raw);

      delete trip.deletedAt;
      trip.updatedAt = new Date().toISOString();

      const activeKey = `trip:${userId}:${tripId}`;
      await kv.put(activeKey, JSON.stringify(trip));

      const stub = getIndexStub(userId);
      await stub.fetch('http://internal/put', {
          method: 'POST',
          body: JSON.stringify(toSummary(trip))
      });

      await trashKV.delete(trashKey);
      return trip;
    },

    async permanentDelete(userId: string, tripId: string) {
      if (!trashKV) throw new Error('Trash KV not available');
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
    },

    // [!code ++] MIGRATION: Moves data from 'username' key to 'uuid' key
    async migrateUser(oldOwnerId: string, newOwnerId: string) {
        console.log(`[MIGRATION] Checking for legacy data: ${oldOwnerId} -> ${newOwnerId}`);
        
        const moveKeys = async (ns: KVNamespace, oldPrefix: string, newPrefixFn: (id: string) => string) => {
            let cursor: string | undefined = undefined;
            let movedCount = 0;
            
            do {
                const list = await ns.list({ prefix: oldPrefix, cursor, limit: 100 });
                for (const key of list.keys) {
                    const raw = await ns.get(key.name);
                    if (raw) {
                        const data = JSON.parse(raw);
                        
                        // Update ownership fields in the JSON blob
                        if (data.userId) data.userId = newOwnerId; 
                        if (data.metadata?.deletedBy) data.metadata.deletedBy = newOwnerId;
                        
                        // Construct new key: swap prefix
                        // Old: trip:james:123  -> New: trip:uuid:123
                        const suffix = key.name.substring(oldPrefix.length);
                        const newKey = newPrefixFn(newOwnerId) + suffix;
                        
                        await ns.put(newKey, JSON.stringify(data));
                        await ns.delete(key.name);
                        movedCount++;
                    }
                }
                cursor = list.list_complete ? undefined : list.cursor;
            } while (cursor);
            
            if (movedCount > 0) {
                console.log(`[MIGRATION] Moved ${movedCount} items from ${oldPrefix}`);
            }
        };

        // 1. Move Active Trips
        await moveKeys(kv, `trip:${oldOwnerId}:`, (id) => `trip:${id}:`);
        
        // 2. Move Trash
        if (trashKV) {
            await moveKeys(trashKV, `trash:${oldOwnerId}:`, (id) => `trash:${id}:`);
        }
    }
  };
}