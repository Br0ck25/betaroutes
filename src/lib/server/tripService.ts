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
  deleted?: boolean; 
  [key: string]: any;
};

export type TrashMetadata = {
  deletedAt: string;
  deletedBy: string;
  originalKey: string;
  expiresAt: string;
};

// Generic Trash Item
export type TrashItem = {
    // Flattened structure for client consumption
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
  tripIndexDO: DurableObjectNamespace
) {
  // ... (keep getIndexStub, toSummary, indexTripData, checkMonthlyQuota, list, get, put)
  
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
      startTime: trip.startTime,
      endTime: trip.endTime,
      netProfit: trip.netProfit,
      totalEarnings: trip.totalEarnings, 
      fuelCost: trip.fuelCost,
      maintenanceCost: trip.maintenanceCost,
      suppliesCost: trip.suppliesCost,
      maintenanceItems: trip.maintenanceItems,
      supplyItems: trip.supplyItems,
      suppliesItems: trip.suppliesItems, 
      totalMiles: trip.totalMiles,
      hoursWorked: trip.hoursWorked,      
      estimatedTime: trip.estimatedTime,  
      totalTime: trip.totalTime,
      stopsCount: trip.stops?.length || 0,
      stops: trip.stops, 
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      deleted: trip.deleted 
  });

  async function indexTripData(trip: TripRecord) {
      // ... (implementation hidden for brevity, unchanged)
    if (!placesKV || trip.deleted) return;
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
      if (since) {
          const sinceDate = new Date(since);
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
      await stub.fetch('http://internal/put', {
          method: 'POST',
          body: JSON.stringify(toSummary(trip))
      });
      indexTripData(trip).catch(e => {
        console.error('[TripService] Failed to index trip data:', e);
      });
    },

    async delete(userId: string, tripId: string) {
      const key = `trip:${userId}:${tripId}`;
      const raw = await kv.get(key);
      if (!raw) return; 

      const trip = JSON.parse(raw);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); 

      // 1. Copy to Trash KV
      if (trashKV) {
        const metadata: TrashMetadata = {
          deletedAt: now.toISOString(),
          deletedBy: userId,
          originalKey: key,
          expiresAt: expiresAt.toISOString()
        };

        const trashKey = `trash:${userId}:${tripId}`;
        
        // Save with type info
        const trashPayload = {
            type: 'trip', // Explicit type
            data: trip,
            metadata
        };
        
        await trashKV.put(
          trashKey, 
          JSON.stringify(trashPayload),
          { expirationTtl: 30 * 24 * 60 * 60 }
        );
      }

      // 2. Overwrite Main KV with SCRUBBED Tombstone
      const tombstone = {
          id: trip.id,
          userId: trip.userId,
          deleted: true,
          deletedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          createdAt: trip.createdAt 
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

    // Updated to handle both trips and expenses
    async listTrash(userId: string): Promise<TrashItem[]> {
      if (!trashKV) return [];
      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      const out: TrashItem[] = [];

      for (const k of list.keys) {
        const raw = await trashKV.get(k.name);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        
        // Handle Legacy/Trip Format vs New Generic Format
        let item: any;
        let type: 'trip' | 'expense' = 'trip';
        
        if (parsed.trip) {
            // Legacy format: { trip: ..., metadata: ... }
            item = parsed.trip;
            type = 'trip';
        } else if (parsed.type && parsed.data) {
            // New format: { type: 'expense'|'trip', data: ..., metadata: ... }
            item = parsed.data;
            type = parsed.type;
        } else {
            // Fallback
            item = parsed;
        }

        // Add flattened metadata + discriminator
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
      
      // Determine Type and Data
      let item: any;
      let type: 'trip' | 'expense' = 'trip';
      
      if (parsed.trip) {
          item = parsed.trip;
          type = 'trip';
      } else if (parsed.type && parsed.data) {
          item = parsed.data;
          type = parsed.type;
      }

      // Cleanup Deleted Flags
      delete item.deletedAt;
      delete item.deleted;
      item.updatedAt = new Date().toISOString();

      if (type === 'trip') {
          // Restore Trip
          const activeKey = `trip:${userId}:${item.id}`;
          await kv.put(activeKey, JSON.stringify(item));
          
          const stub = getIndexStub(userId);
          await stub.fetch('http://internal/put', {
              method: 'POST',
              body: JSON.stringify(toSummary(item))
          });
      } else if (type === 'expense') {
          // Restore Expense
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