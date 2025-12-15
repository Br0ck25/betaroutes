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
  destinations?: any[];
  startAddress?: string;
  endAddress?: string;
  startLocation?: { lat: number, lng: number };
  endLocation?: { lat: number, lng: number };
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
  [key: string]: any;
};

// ... (Trash types remain same)

// [!code fix] Scoped Index Keys
function prefixForUser(userId: string) { return `trip:${userId}:`; }
function trashPrefixForUser(userId: string) { return `trash:${userId}:`; }
function indexKeyForUser(userId: string) { return `index:trips:${userId}`; }

// Helper to sanitize keys without hashing (Reverted Hashing)
function safeKey(str: string): string {
    return str.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 400); 
}

function normalizeIndex(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
}

export function makeTripService(
  kv: KVNamespace,
  trashKV: KVNamespace | undefined,
  placesKV: KVNamespace | undefined
) {
  
  // Indexing logic for Autocomplete
  async function indexTripData(trip: TripRecord) {
    if (!placesKV) return;
    const userId = trip.userId;

    // 1. Gather Unique Data
    const uniquePlaces = new Map<string, { lat?: number, lng?: number, raw: string }>();
    
    const add = (addr?: string, loc?: { lat: number, lng: number }) => {
        if (!addr || addr.length < 3) return;
        // Use normalized key for dedupe, but store raw address
        const key = normalizeIndex(addr);
        if (!uniquePlaces.has(key) || loc) {
            uniquePlaces.set(key, { ...(loc || {}), raw: addr });
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

    for (const [_, data] of uniquePlaces.entries()) {
        const addrText = data.raw;

        // --- A. Cache Place Details (User Scoped) ---
        if (data.lat !== undefined && data.lng !== undefined) {
            // [!code fix] Reverted hashing, used safe string key + userId
            const detailKey = `place:${userId}:${safeKey(addrText)}`;
            const payload = { 
               lastSeen: new Date().toISOString(),
               formatted_address: addrText,
               lat: data.lat,
               lng: data.lng
            };
            writePromises.push(placesKV.put(detailKey, JSON.stringify(payload)));
        }

        // --- B. Update Autocomplete Buckets (User Scoped) ---
        // Generate prefixes for the address (2-10 chars)
        const normalized = normalizeIndex(addrText);
        const prefixes = new Set<string>();
        for (let i = 2; i <= Math.min(10, normalized.length); i++) {
            prefixes.add(normalized.substring(0, i));
        }

        for (const p of prefixes) {
            const bucketKey = `prefix:${userId}:${p}`;
            const updateBucket = async () => {
                const raw = await placesKV!.get(bucketKey);
                let bucket = raw ? JSON.parse(raw) : [];
                
                // Add if not exists
                if (!bucket.some((b:any) => b.formatted_address === addrText)) {
                    bucket.push({ formatted_address: addrText, source: 'history' });
                    // Cap size
                    if (bucket.length > 20) bucket = bucket.slice(0, 20);
                    await placesKV!.put(bucketKey, JSON.stringify(bucket));
                }
            };
            writePromises.push(updateBucket());
        }
    }

    await Promise.allSettled(writePromises);
  }

  // ... (Rest of the service: updateIndex, get, put, delete, etc. remains largely same)
  // Ensure 'put' calls indexTripData
  
  async function updateIndex(userId: string, trip: TripRecord, action: 'put' | 'delete') {
      const idxKey = indexKeyForUser(userId);
      const idxRaw = await kv.get(idxKey);
      let trips: TripRecord[] = idxRaw ? JSON.parse(idxRaw) : [];

      if (!idxRaw) {
          // Rebuild fallback
          const prefix = prefixForUser(userId);
          const list = await kv.list({ prefix });
          for (const k of list.keys) {
             const raw = await kv.get(k.name);
             if (raw) trips.push(JSON.parse(raw));
          }
      }

      if (action === 'put') {
          const idx = trips.findIndex(t => t.id === trip.id);
          if (idx >= 0) trips[idx] = trip;
          else trips.push(trip);
      } else {
          trips = trips.filter(t => t.id !== trip.id);
      }
      
      trips.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      await kv.put(idxKey, JSON.stringify(trips));
  }

  return {
    async getMonthlyTripCount(userId: string): Promise<number> {
        // [!code fix] Ensure scoped keys
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
        const raw = await kv.get(idxKey);
        if (raw) return JSON.parse(raw);
        
        // Fallback
        const prefix = prefixForUser(userId);
        const list = await kv.list({ prefix });
        const out = [];
        for (const k of list.keys) {
            const r = await kv.get(k.name);
            if (r) out.push(JSON.parse(r));
        }
        out.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
        if (out.length > 0) await kv.put(idxKey, JSON.stringify(out));
        return out;
    },

    async get(userId: string, tripId: string) {
        // [!code fix] Validate inputs
        if (!userId || !tripId) return null;
        const key = `trip:${userId}:${tripId}`;
        const raw = await kv.get(key);
        return raw ? JSON.parse(raw) : null;
    },

    async put(trip: TripRecord) {
        if (!trip.userId || !trip.id) throw new Error("Invalid Trip Data");
        trip.updatedAt = new Date().toISOString();
        const key = `trip:${trip.userId}:${trip.id}`;
        await kv.put(key, JSON.stringify(trip));
        await updateIndex(trip.userId, trip, 'put');
        // Index for autocomplete
        indexTripData(trip).catch(console.error);
    },

    // ... (delete, trash, restore methods follow similar user-scoped patterns)
    async delete(userId: string, tripId: string) {
        if (!trashKV) {
            const key = `trip:${userId}:${tripId}`;
            await kv.delete(key);
            await updateIndex(userId, { id: tripId } as any, 'delete');
            return;
        }
        const key = `trip:${userId}:${tripId}`;
        const raw = await kv.get(key);
        if (!raw) throw new Error('Trip not found');
        
        const trip = JSON.parse(raw);
        const now = new Date();
        trip.deletedAt = now.toISOString();
        
        const trashKey = `trash:${userId}:${tripId}`;
        await trashKV.put(trashKey, JSON.stringify({
            trip,
            metadata: { 
                deletedAt: now.toISOString(),
                deletedBy: userId,
                originalKey: key,
                expiresAt: new Date(now.getTime() + 30*24*60*60*1000).toISOString()
            }
        }), { expirationTtl: 2592000 }); // 30 days
        
        await kv.delete(key);
        await updateIndex(userId, trip, 'delete');
    },

    async listTrash(userId: string) {
        if (!trashKV) return [];
        const prefix = trashPrefixForUser(userId);
        const list = await trashKV.list({ prefix });
        const out = [];
        for (const k of list.keys) {
            const r = await trashKV.get(k.name);
            if (r) {
                const d = JSON.parse(r);
                out.push({ ...d.trip, metadata: d.metadata });
            }
        }
        return out;
    },

    async emptyTrash(userId: string) {
        if (!trashKV) return 0;
        const prefix = trashPrefixForUser(userId);
        const list = await trashKV.list({ prefix });
        let c = 0;
        for (const k of list.keys) {
            await trashKV.delete(k.name);
            c++;
        }
        return c;
    },

    async restore(userId: string, tripId: string) {
        if (!trashKV) throw new Error('No trash');
        const trashKey = `trash:${userId}:${tripId}`;
        const raw = await trashKV.get(trashKey);
        if (!raw) throw new Error('Not found in trash');
        
        const { trip } = JSON.parse(raw);
        delete trip.deletedAt;
        trip.updatedAt = new Date().toISOString();
        
        await kv.put(`trip:${userId}:${tripId}`, JSON.stringify(trip));
        await updateIndex(userId, trip, 'put');
        await trashKV.delete(trashKey);
        return trip;
    },

    async permanentDelete(userId: string, tripId: string) {
        if (!trashKV) return;
        await trashKV.delete(`trash:${userId}:${tripId}`);
    },

    async incrementUserCounter(userId: string, amt = 1) {
        const key = `meta:user:${userId}:trip_count`;
        const raw = await kv.get(key);
        const n = (raw ? parseInt(raw) : 0) + amt;
        await kv.put(key, n.toString());
        return n;
    }
  };
}