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
        try {
            const t = JSON.parse(raw);
            out.push(t);
        } catch (e) { console.error('Error parsing trip', k.name); }
      }

      out.sort((a,b)=> (b.createdAt || '').localeCompare(a.createdAt || ''));
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
      const key = `trip:${userId}:${tripId}`;
      
      if (!trashKV) {
        await kv.delete(key);
        return;
      }

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

      // Move to trash KV with metadata
      const trashKey = `trash:${userId}:${tripId}`;
      
      // Save properly structured object
      await trashKV.put(
        trashKey, 
        JSON.stringify({ trip, metadata }),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );

      // Remove from active trips
      await kv.delete(key);
    },

    // --- CRITICAL FIX: Safe Trash Listing ---
    async listTrash(userId: string): Promise<TrashItem[]> {
      if (!trashKV) return [];
      const prefix = trashPrefixForUser(userId);
      const list = await trashKV.list({ prefix });
      const out: TrashItem[] = [];

      for (const k of list.keys) {
        const raw = await trashKV.get(k.name);
        if (!raw) continue;
        
        try {
            const parsed = JSON.parse(raw);
            
            // Validate structure to prevent UI crashes
            if (parsed.trip && parsed.metadata) {
                out.push({ ...parsed.trip, metadata: parsed.metadata });
            } else if (parsed.id && parsed.deletedAt) {
                // Handle flat format (fallback)
                out.push({ 
                    ...parsed, 
                    metadata: { 
                        deletedAt: parsed.deletedAt, 
                        deletedBy: userId, 
                        originalKey: '', 
                        expiresAt: '' 
                    } 
                });
            }
        } catch (e) {
            console.error('Skipping malformed trash item:', k.name);
        }
      }

      // Safe Sort
      out.sort((a, b) => {
          const dateA = a.metadata?.deletedAt || '';
          const dateB = b.metadata?.deletedAt || '';
          return dateB.localeCompare(dateA);
      });
      
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

      let trip, metadata;
      try {
          const parsed = JSON.parse(raw);
          if (parsed.trip) {
              trip = parsed.trip;
              metadata = parsed.metadata;
          } else {
              trip = parsed; // flat format
          }
      } catch (e) { throw new Error('Malformed trash data'); }

      // Remove deletion timestamp
      delete trip.deletedAt;
      trip.updatedAt = new Date().toISOString();

      // Restore to active trips
      // Use the ID from the trip object to ensure it goes back to the right user
      const ownerId = trip.userId || userId; 
      const activeKey = `trip:${ownerId}:${tripId}`;
      
      await kv.put(activeKey, JSON.stringify(trip));
      await trashKV.delete(trashKey);

      return trip;
    },

    async permanentDelete(userId: string, tripId: string) {
      if (!trashKV) throw new Error('Trash KV not available');
      const trashKey = `trash:${userId}:${tripId}`;
      await trashKV.delete(trashKey);
    },

    async incrementUserCounter(userId: string, amt = 1) {
      if (!userId) return 0;
      const key = `meta:user:${userId}:trip_count`;
      const raw = await kv.get(key);
      const cur = raw ? parseInt(raw,10) : 0;
      const next = Math.max(0, cur + amt);
      await kv.put(key, String(next));
      return next;
    }
  };
}