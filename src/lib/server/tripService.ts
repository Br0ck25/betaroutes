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
  deleted?: boolean; // [!code ++] Added for Soft Delete
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
      
      // Time
      startTime: trip.startTime,
      endTime: trip.endTime,

      // Financials
      netProfit: trip.netProfit,
      totalEarnings: trip.totalEarnings, 
      fuelCost: trip.fuelCost,
      maintenanceCost: trip.maintenanceCost,
      suppliesCost: trip.suppliesCost,

      // Itemized Lists
      maintenanceItems: trip.maintenanceItems,
      supplyItems: trip.supplyItems,
      suppliesItems: trip.suppliesItems, 

      // Stats
      totalMiles: trip.totalMiles,
      hoursWorked: trip.hoursWorked,      
      estimatedTime: trip.estimatedTime,  
      totalTime: trip.totalTime,
      stopsCount: trip.stops?.length || 0,
      
      // Stops
      stops: trip.stops, 

      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      
      // [!code ++] Critical for Delta Sync
      deleted: trip.deleted 
  });

  async function indexTripData(trip: TripRecord) {
    if (!placesKV || trip.deleted) return; // [!code ++] Don't index deleted items
    
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
        
        if (!res.ok) return { allowed: false, count: limit }; 
        return await res.json() as { allowed: boolean, count: number };
    },

    // [!code fix] Added 'since' parameter for delta sync
    async list(userId: string, since?: string): Promise<TripRecord[]> {
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

      const trips = data as TripRecord[];

      // [!code ++] Handle Delta Sync vs Full Sync
      if (since) {
          const sinceDate = new Date(since);
          // Return everything (including tombstones) that changed after 'since'
          return trips.filter(t => new Date(t.updatedAt || t.createdAt) > sinceDate);
      } else {
          // Full Sync: Return ONLY active records (exclude tombstones)
          return trips.filter(t => !t.deleted);
      }
    },

    async get(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      return raw ? JSON.parse(raw) as TripRecord : null;
    },

    async put(trip: TripRecord) {
      trip.updatedAt = new Date().toISOString();
      // Ensure we clear the deleted flag on put/restore
      delete trip.deleted;
      delete trip.deletedAt;
      
      // 1. Save Full Data to KV
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
      
      // 2. Update Index via DO using the COMPLETE summary
      const stub = getIndexStub(trip.userId);
      await stub.fetch('http://internal/put', {
          method: 'POST',
          body: JSON.stringify(toSummary(trip))
      });

      indexTripData(trip).catch(e => {
        console.error('[TripService] Failed to index trip data:', e);
      });
    },

    // [!code fix] Soft Delete + Scrub Implementation
    async delete(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      if (!raw) return; 

      const trip = JSON.parse(raw);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); 

      // 1. Copy to Trash KV (Full Backup)
      if (trashKV) {
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
      }

      // 2. Overwrite Main KV with SCRUBBED Tombstone
      // This wipes the data but keeps the ID so sync works.
      const tombstone = {
          id: trip.id,
          userId: trip.userId,
          deleted: true,
          deletedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          createdAt: trip.createdAt // Keep sort order
      };

      await kv.put(key, JSON.stringify(tombstone));

      // 3. Update Index (DO) with Tombstone summary
      const stub = getIndexStub(userId);
      await stub.fetch('http://internal/put', {
          method: 'POST',
          body: JSON.stringify(toSummary(tombstone as TripRecord))
      });

      // 4. Handle Billing
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await stub.fetch('http://internal/billing/decrement', {
          method: 'POST',
          body: JSON.stringify({ monthKey })
      });
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

      // Remove deleted flags and revive data
      delete trip.deletedAt;
      delete trip.deleted;
      trip.updatedAt = new Date().toISOString();

      const activeKey = `trip:${userId}:${tripId}`;
      await kv.put(activeKey, JSON.stringify(trip));

      // Update Index via DO with restored summary
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
    }
  };
}