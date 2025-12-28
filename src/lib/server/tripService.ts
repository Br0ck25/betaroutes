// src/lib/server/tripService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { generatePrefixKey, generatePlaceKey } from '$lib/utils/keys';
import { DO_ORIGIN, RETENTION } from '$lib/constants';

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
  deleted?: boolean; 
  [key: string]: any;
};

export type TrashMetadata = {
  deletedAt: string;
  deletedBy: string;
  originalKey: string;
  expiresAt: string;
};

export type TrashItem = {
    id: string;
    userId: string;
    recordType: 'trip' | 'expense';
    metadata: TrashMetadata;
    [key: string]: any;
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
  tripIndexDO: DurableObjectNamespace,
  placesIndexDO: DurableObjectNamespace
) {
  
  const getIndexStub = (userId: string) => {
    const id = tripIndexDO.idFromName(userId);
    return tripIndexDO.get(id);
  };

  const toSummary = (trip: TripRecord) => ({
      id: trip.id,
      userId: trip.userId,
      date: (trip as any)['date'],
      title: trip.title,
      startAddress: (trip as any)['startAddress'],
      endAddress: (trip as any)['endAddress'],
      startTime: (trip as any)['startTime'],
      endTime: (trip as any)['endTime'],
      netProfit: (trip as any)['netProfit'],
      totalEarnings: (trip as any)['totalEarnings'], 
      fuelCost: (trip as any)['fuelCost'],
      maintenanceCost: (trip as any)['maintenanceCost'],
      suppliesCost: (trip as any)['suppliesCost'],
      maintenanceItems: (trip as any)['maintenanceItems'],
      supplyItems: (trip as any)['supplyItems'],
      suppliesItems: (trip as any)['suppliesItems'], 
      totalMiles: (trip as any)['totalMiles'],
      hoursWorked: (trip as any)['hoursWorked'],      
      estimatedTime: (trip as any)['estimatedTime'],  
      totalTime: (trip as any)['totalTime'],
      stopsCount: (trip as any)['stops']?.length || 0,
      stops: (trip as any)['stops'], 
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      deleted: trip.deleted 
  });

  /**
   * Reliability Fix: Refactored indexing logic.
   * Uses try-catch and allSettled to ensure that one failed API call 
   * doesn't corrupt the entire indexing process or crash the put() operation.
   */
  async function indexTripData(trip: TripRecord) {
    if (!placesKV || trip.deleted) return;
    
    try {
        const uniquePlaces = new Map<string, { lat?: number, lng?: number }>();
        const add = (addr?: string, loc?: { lat: number, lng: number }) => {
            if (!addr || addr.length < 3) return;
            const normalized = addr.toLowerCase().trim();
            if (!uniquePlaces.has(normalized) || loc) {
                uniquePlaces.set(normalized, loc || {});
            }
        };
        
        add((trip as any)['startAddress'], (trip as any)['startLocation']);
        add((trip as any)['endAddress'], (trip as any)['endLocation']);
        if (Array.isArray((trip as any)['stops'])) {
          (trip as any)['stops'].forEach((s: any) => add(s.address, s.location));
        }
        if (Array.isArray((trip as any)['destinations'])) {
          (trip as any)['destinations'].forEach((d: any) => add(d.address, d.location));
        }

        const writePromises: Promise<any>[] = [];
        
        for (const [addrKey, data] of uniquePlaces.entries()) {
           // 1. Update individual place metadata if coordinates exist
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

           // 2. Update search index Durable Object
           const prefixKey = generatePrefixKey(addrKey);
           const stub = placesIndexDO.get(placesIndexDO.idFromName(prefixKey));
           
           writePromises.push(
               stub.fetch(`${DO_ORIGIN}/add?key=${encodeURIComponent(prefixKey)}`, {
                   method: 'POST',
                   body: JSON.stringify({ address: addrKey })
               })
           );
        }
        
        // Ensure allSettled so one failure doesn't stop the others
        const results = await Promise.allSettled(writePromises);
        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length > 0) {
            console.error(`[TripService] Indexing had ${rejected.length} failures for trip ${trip.id}`);
        }
    } catch (err) {
        console.error('[TripService] Critical error in indexTripData:', err);
    }
  }

  return {
    async checkMonthlyQuota(userId: string, limit: number): Promise<{ allowed: boolean, count: number }> {
        const date = new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const stub = getIndexStub(userId);
        
        const res = await stub.fetch(`${DO_ORIGIN}/billing/check-increment`, {
            method: 'POST',
            body: JSON.stringify({ monthKey, limit })
        });
        if (!res.ok) return { allowed: false, count: limit }; 
        return await res.json() as { allowed: boolean, count: number };
    },

    async list(userId: string, options: { since?: string, limit?: number, offset?: number } = {}): Promise<TripRecord[]> {
      const stub = getIndexStub(userId);
      
      let url = `${DO_ORIGIN}/list`;
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', String(options.limit));
      if (options.offset) params.set('offset', String(options.offset));
      if (params.size > 0) url += `?${params.toString()}`;

      const res = await stub.fetch(url);
      
      if (!res.ok) {
          console.error(`[TripService] DO Error: ${res.status}`);
          return [];
      }

      const data = await res.json() as { trips: TripRecord[], needsMigration?: boolean } | TripRecord[];

      let trips: TripRecord[] = [];
      let needsMigration = false;
      
      if (Array.isArray(data)) {
          trips = data;
      } else {
          trips = data.trips || [];
          needsMigration = !!data.needsMigration;
      }

      if (needsMigration) {
          console.log(`[TripService] Migrating index for user ${userId} to Durable Object...`);
          const prefix = prefixForUser(userId);
          
          const out: TripRecord[] = [];
          let list = await kv.list({ prefix });
          let keys = list.keys;

          while (!list.list_complete && list.cursor) {
              list = await kv.list({ prefix, cursor: list.cursor });
              keys = keys.concat(list.keys);
          }
          
          for (const k of keys) {
            const raw = await kv.get(k.name);
            if (!raw) continue;
            const t = JSON.parse(raw);
            out.push(t);
          }
          
          const summaries = out.map(toSummary);
          
          await stub.fetch(`${DO_ORIGIN}/migrate`, {
              method: 'POST',
              body: JSON.stringify(summaries)
          });
          
          out.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
          return out;
      }

      if (options.since) {
          const sinceDate = new Date(options.since);
          return trips.filter(t => new Date(t.updatedAt || t.createdAt) > sinceDate);
      } else {
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
      delete trip.deleted;
      delete trip.deletedAt;
      await kv.put(`trip:${trip.userId}:${trip.id}`, JSON.stringify(trip));
      const stub = getIndexStub(trip.userId);
      
      await stub.fetch(`${DO_ORIGIN}/put`, {
          method: 'POST',
          body: JSON.stringify(toSummary(trip))
      });
      
      try {
        await indexTripData(trip);
      } catch (e) {
        console.error('[TripService] Failed to index trip data:', e);
      }
    },

    async delete(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      if (!raw) return; 

      const trip = JSON.parse(raw);
      const now = new Date();
      // Reliability Fix: Use RETENTION constant
      const expiresAt = new Date(now.getTime() + (RETENTION.THIRTY_DAYS * 1000)); 

      // 1. Copy to Trash KV
      if (trashKV) {
        const metadata: TrashMetadata = {
          deletedAt: now.toISOString(),
          deletedBy: userId,
          originalKey: key,
          expiresAt: expiresAt.toISOString()
        };

        const trashKey = `trash:${userId}:${tripId}`;
        const trashPayload = {
            type: 'trip', 
            data: trip,
            metadata
        };
        
        await trashKV.put(
          trashKey, 
          JSON.stringify(trashPayload),
          { expirationTtl: RETENTION.THIRTY_DAYS }
        );
      }

      // 2. Overwrite Main KV with Tombstone
      const tombstone = {
          id: trip.id,
          userId: trip.userId,
          deleted: true,
          deletedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          createdAt: trip.createdAt 
      };

      await kv.put(key, JSON.stringify(tombstone), { expirationTtl: RETENTION.THIRTY_DAYS });

      // 3. Update Index (DO) with DELETE command
      const stub = getIndexStub(userId);
      await stub.fetch(`${DO_ORIGIN}/delete`, {
          method: 'POST',
          body: JSON.stringify({ id: trip.id })
      });

      // 4. Handle Billing
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await stub.fetch(`${DO_ORIGIN}/billing/decrement`, {
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
        const parsed = JSON.parse(raw);
        
        let item: any;
        let type: 'trip' | 'expense' = 'trip';
        
        if (parsed.trip) {
            item = parsed.trip;
            type = 'trip';
        } else if (parsed.type && parsed.data) {
            item = parsed.data;
            type = parsed.type;
        } else {
            item = parsed;
        }

        out.push({ 
            ...item, 
            metadata: parsed.metadata,
            recordType: type 
        });
      }

      out.sort((a,b)=> (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
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

    async restore(userId: string, itemId: string) {
      if (!trashKV) throw new Error('Trash KV not available');

      const trashKey = `trash:${userId}:${itemId}`;
      const raw = await trashKV.get(trashKey);

      if (!raw) throw new Error('Item not found in trash');

      const parsed = JSON.parse(raw);
      
      let item: any;
      let type: 'trip' | 'expense' = 'trip';
      
      if (parsed.trip) {
          item = parsed.trip;
          type = 'trip';
      } else if (parsed.type && parsed.data) {
          item = parsed.data;
          type = parsed.type;
      }

      delete item.deletedAt;
      delete item.deleted;
      item.updatedAt = new Date().toISOString();

      if (type === 'trip') {
          const activeKey = `trip:${userId}:${item.id}`;
          await kv.put(activeKey, JSON.stringify(item));
          
          const stub = getIndexStub(userId);
          await stub.fetch(`${DO_ORIGIN}/put`, {
              method: 'POST',
              body: JSON.stringify(toSummary(item))
          });
      } else if (type === 'expense') {
          const activeKey = `expense:${userId}:${item.id}`;
          await kv.put(activeKey, JSON.stringify(item));
      }

      await trashKV.delete(trashKey);
      return item;
    },

    async permanentDelete(userId: string, itemId: string) {
      if (!trashKV) throw new Error('Trash KV not available');
      const trashKey = `trash:${userId}:${itemId}`;
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