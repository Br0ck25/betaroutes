// src/lib/stores/trips.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';

/**
 * Offline-first trips store
 * 
 * All operations save to IndexedDB FIRST, then queue for cloud sync
 * Works 100% offline - syncs automatically when online
 */
function createTripsStore() {
  const { subscribe, set, update } = writable<TripRecord[]>([]);

  return {
    subscribe,

    /**
     * Load all trips from IndexedDB
     * Call this on app startup
     */
    async load(userId?: string) {
      try {
        console.log('📚 Loading trips from IndexedDB...');
        const db = await getDB();
        const tx = db.transaction('trips', 'readonly');
        const store = tx.objectStore('trips');

        let trips: TripRecord[];

        if (userId) {
          // Load trips for specific user
          const index = store.index('userId');
          trips = await index.getAll(userId);
        } else {
          // Load all trips (for dev/testing)
          trips = await store.getAll();
        }

        // Sort by date (newest first)
        trips.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt).getTime();
          const dateB = new Date(b.updatedAt || b.createdAt).getTime();
          return dateB - dateA;
        });

        set(trips);
        console.log(`✅ Loaded ${trips.length} trip(s) from IndexedDB`);

        return trips;
      } catch (err) {
        console.error('❌ Failed to load trips:', err);
        set([]);
        return [];
      }
    },

    /**
     * Create a new trip (offline-first)
     */
    async create(tripData: Partial<TripRecord>, userId: string) {
      try {
        // Create trip object
        const trip: TripRecord = {
          ...tripData,
          id: crypto.randomUUID(),
          userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
        } as TripRecord;

        console.log('💾 Creating trip in IndexedDB:', trip.id);

        // 1. Save to IndexedDB FIRST
        const db = await getDB();
        const tx = db.transaction('trips', 'readwrite');
        await tx.objectStore('trips').add(trip);
        await tx.done;

        // 2. Update UI immediately (optimistic update)
        update(trips => [trip, ...trips]);

        // 3. Queue for cloud sync
        await syncManager.addToQueue({
          action: 'create',
          tripId: trip.id,
          data: trip,
        });

        console.log('✅ Trip created:', trip.id);

        return trip;
      } catch (err) {
        console.error('❌ Failed to create trip:', err);
        throw err;
      }
    },

    /**
     * Update an existing trip (offline-first)
     */
    async updateTrip(id: string, changes: Partial<TripRecord>, userId: string) {
      try {
        console.log('💾 Updating trip in IndexedDB:', id);

        const db = await getDB();
        const tx = db.transaction('trips', 'readwrite');
        const store = tx.objectStore('trips');

        // Get existing trip
        const existing = await store.get(id);
        if (!existing) {
          throw new Error('Trip not found');
        }

        // Verify ownership
        if (existing.userId !== userId) {
          throw new Error('Unauthorized');
        }

        // Create updated trip
        const updated: TripRecord = {
          ...existing,
          ...changes,
          id, // Ensure ID doesn't change
          userId, // Ensure userId doesn't change
          updatedAt: new Date().toISOString(),
          syncStatus: 'pending',
        };

        // 1. Save to IndexedDB
        await store.put(updated);
        await tx.done;

        // 2. Update UI immediately
        update(trips => trips.map(t => (t.id === id ? updated : t)));

        // 3. Queue for cloud sync
        await syncManager.addToQueue({
          action: 'update',
          tripId: id,
          data: updated,
        });

        console.log('✅ Trip updated:', id);

        return updated;
      } catch (err) {
        console.error('❌ Failed to update trip:', err);
        throw err;
      }
    },

    /**
     * Delete a trip (soft delete - move to trash)
     * Works offline!
     */
    async deleteTrip(id: string, userId: string) {
      try {
        console.log('🗑️ Moving trip to trash:', id);

        const db = await getDB();

        // 1. Get trip from active trips
        const tripsTx = db.transaction('trips', 'readonly');
        const trip = await tripsTx.objectStore('trips').get(id);

        if (!trip) {
          throw new Error('Trip not found');
        }

        // Verify ownership
        if (trip.userId !== userId) {
          throw new Error('Unauthorized');
        }

        // 2. Create trash item
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const trashItem = {
          ...trip,
          deletedAt: now.toISOString(),
          deletedBy: userId,
          expiresAt: expiresAt.toISOString(),
          originalKey: `trip:${userId}:${id}`,
          syncStatus: 'pending' as const,
        };

        // 3. Move to trash in IndexedDB
        const trashTx = db.transaction('trash', 'readwrite');
        await trashTx.objectStore('trash').put(trashItem);
        await trashTx.done;

        // 4. Remove from active trips in IndexedDB
        const deleteTx = db.transaction('trips', 'readwrite');
        await deleteTx.objectStore('trips').delete(id);
        await deleteTx.done;

        // 5. Update UI immediately
        update(trips => trips.filter(t => t.id !== id));

        // 6. Queue for cloud sync
        await syncManager.addToQueue({
          action: 'delete',
          tripId: id,
        });

        console.log('✅ Trip moved to trash:', id);
      } catch (err) {
        console.error('❌ Failed to delete trip:', err);
        throw err;
      }
    },

    /**
     * Get a single trip by ID
     */
    async get(id: string, userId: string) {
      try {
        const db = await getDB();
        const tx = db.transaction('trips', 'readonly');
        const trip = await tx.objectStore('trips').get(id);

        if (!trip) {
          return null;
        }

        // Verify ownership
        if (trip.userId !== userId) {
          return null;
        }

        return trip;
      } catch (err) {
        console.error('❌ Failed to get trip:', err);
        return null;
      }
    },

    /**
     * Get trip count for user
     */
    async getCount(userId: string) {
      try {
        const db = await getDB();
        const tx = db.transaction('trips', 'readonly');
        const index = tx.objectStore('trips').index('userId');
        const trips = await index.getAll(userId);
        return trips.length;
      } catch (err) {
        console.error('❌ Failed to get count:', err);
        return 0;
      }
    },

    /**
     * Clear all trips from store (for logout)
     */
    clear() {
      set([]);
    },

    /**
     * Sync from cloud (pull remote changes)
     * Call this after login or when wanting to refresh
     */
    async syncFromCloud(userId: string) {
      try {
        if (!navigator.onLine) {
          console.log('📴 Cannot sync from cloud while offline');
          return;
        }

        console.log('🔄 Syncing trips from cloud...');

        const response = await fetch('/api/trips');
        if (!response.ok) {
          throw new Error('Failed to fetch trips from cloud');
        }

        const cloudTrips = await response.json();

        // Merge with local trips
        const db = await getDB();
        const tx = db.transaction('trips', 'readwrite');
        const store = tx.objectStore('trips');

        for (const cloudTrip of cloudTrips) {
          const local = await store.get(cloudTrip.id);

          // Only update if cloud is newer or doesn't exist locally
          if (!local || new Date(cloudTrip.updatedAt) > new Date(local.updatedAt)) {
            await store.put({
              ...cloudTrip,
              syncStatus: 'synced',
              lastSyncedAt: new Date().toISOString(),
            });
          }
        }

        await tx.done;

        // Reload from IndexedDB
        await this.load(userId);

        console.log('✅ Synced from cloud');
      } catch (err) {
        console.error('❌ Failed to sync from cloud:', err);
      }
    },
  };
}

export const trips = createTripsStore();
