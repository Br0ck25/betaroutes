// src/lib/stores/trips.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';

function createTripsStore() {
	const { subscribe, set, update } = writable<TripRecord[]>([]);

	return {
		subscribe,

		async load(userId?: string) {
			const db = await getDB();
			const trips = await db.getAll('trips');
            // Sort Descending
			trips.sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
			set(trips);
		},

		async deleteTrip(id: string, userId: string) {
			const db = await getDB();

            // 1. Get the trip
			const trip = await db.get('trips', id);
			if (!trip) return;

            // 2. Move to Local Trash (IndexedDB)
			const trashItem = { ...trip, deletedAt: new Date().toISOString(), userId };
			await db.put('trash', trashItem);

            // 3. Remove from Active Trips (IndexedDB)
			await db.delete('trips', id);

            // 4. Update Svelte Store UI
			update(list => list.filter(t => t.id !== id));

            // 5. Queue Sync Action
			await syncManager.addToQueue({ action: 'delete', tripId: id });
		},

        // --- THE FIX IS HERE ---
		async syncFromCloud(userId: string) {
			if (!navigator.onLine) return;

			// 1. Fetch Cloud Trips
			const res = await fetch('/api/trips');
			if (!res.ok) return;
			const cloudTrips = await res.json();

			const db = await getDB();

            // 2. CHECK PENDING DELETES: Get all IDs currently waiting in the Sync Queue
            const queue = await db.getAll('syncQueue');
            const pendingDeletes = new Set(
                queue.filter(q => q.action === 'delete').map(q => q.tripId)
            );

            // 3. CHECK LOCAL TRASH: Don't revive items that are already in trash
            const trashItems = await db.getAll('trash');
            const trashIds = new Set(trashItems.map(t => t.id));

            const tx = db.transaction('trips', 'readwrite');
			for (const trip of cloudTrips) {
                // If we are waiting to delete this ID, or it is in trash, IGNORE the cloud version
                if (pendingDeletes.has(trip.id) || trashIds.has(trip.id)) {
                    console.log(`🛡️ Blocking zombie trip: ${trip.id}`);
                    continue; 
                }

                // Otherwise, save/update it
				await tx.store.put({ ...trip, syncStatus: 'synced' });
			}
			await tx.done;
            
            // Reload UI
			await this.load(userId);
		},

        // ... keep your create/update/wipe functions ...
        async wipe() {
             const db = await getDB();
             await db.clear('trips');
             set([]);
        },
        async create(tripData: any, userId: string) {
            // Standard create logic...
             const db = await getDB();
             const trip = { ...tripData, id: tripData.id || crypto.randomUUID(), userId, syncStatus: 'pending' };
             await db.put('trips', trip);
             update(l => [trip, ...l]);
             await syncManager.addToQueue({ action: 'create', tripId: trip.id, data: trip });
        }
	};
}

export const trips = createTripsStore();