// src/lib/stores/trips.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';
import { storage } from '$lib/utils/storage';

/**
 * Offline-first trips store
 * All operations save to IndexedDB FIRST, then queue for cloud sync
 */
function createTripsStore() {
	const { subscribe, set, update } = writable<TripRecord[]>([]);

	return {
		subscribe,

		async load(userId?: string) {
			try {
				console.log('📚 Loading trips from IndexedDB...');
				const db = await getDB();
				const tx = db.transaction('trips', 'readonly');
				const store = tx.objectStore('trips');

				let trips: TripRecord[];

				if (userId) {
					const index = store.index('userId');
					trips = await index.getAll(userId);
				} else {
					trips = await store.getAll();
				}

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

		async create(tripData: Partial<TripRecord>, userId: string) {
			try {
                // FIX: Respect existing IDs and timestamps if provided (for imports/restores)
                // Otherwise generate new ones for fresh trips.
				const trip: TripRecord = {
					...tripData,
					id: tripData.id || crypto.randomUUID(),
					userId,
					createdAt: tripData.createdAt || new Date().toISOString(),
					updatedAt: tripData.updatedAt || new Date().toISOString(),
					syncStatus: 'pending'
				} as TripRecord;

				console.log('💾 Creating/Restoring trip in IndexedDB:', trip.id);

				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				await tx.objectStore('trips').put(trip); // Changed from .add() to .put() to handle overwrites/restores
				await tx.done;

				update((trips) => {
                    // Check if exists to avoid duplicates in UI
                    const exists = trips.find(t => t.id === trip.id);
                    if (exists) return trips.map(t => t.id === trip.id ? trip : t);
                    return [trip, ...trips];
                });

				await syncManager.addToQueue({
					action: 'create', // Server handles upsert logic ideally
					tripId: trip.id,
					data: trip
				});

				console.log('✅ Trip saved:', trip.id);
				return trip;
			} catch (err) {
				console.error('❌ Failed to create trip:', err);
				throw err;
			}
		},

		async updateTrip(id: string, changes: Partial<TripRecord>, userId: string) {
			try {
				console.log('💾 Updating trip in IndexedDB:', id);

				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');

				const existing = await store.get(id);
				if (!existing) throw new Error('Trip not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');

				const updated: TripRecord = {
					...existing,
					...changes,
					id,
					userId,
					updatedAt: new Date().toISOString(),
					syncStatus: 'pending'
				};

				await store.put(updated);
				await tx.done;

				update((trips) => trips.map((t) => (t.id === id ? updated : t)));

				await syncManager.addToQueue({
					action: 'update',
					tripId: id,
					data: updated
				});

				console.log('✅ Trip updated:', id);
				return updated;
			} catch (err) {
				console.error('❌ Failed to update trip:', err);
				throw err;
			}
		},

		async deleteTrip(id: string, userId: string) {
			try {
				console.log('🗑️ Moving trip to trash:', id);
				const db = await getDB();

				const tripsTx = db.transaction('trips', 'readonly');
				const trip = await tripsTx.objectStore('trips').get(id);
				if (!trip) throw new Error('Trip not found');
				if (trip.userId !== userId) throw new Error('Unauthorized');

				const now = new Date();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

				const trashItem = {
					...trip,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					originalKey: `trip:${userId}:${id}`,
					syncStatus: 'pending' as const
				};

				const trashTx = db.transaction('trash', 'readwrite');
				await trashTx.objectStore('trash').put(trashItem);
				await trashTx.done;

				const deleteTx = db.transaction('trips', 'readwrite');
				await deleteTx.objectStore('trips').delete(id);
				await deleteTx.done;

				update((trips) => trips.filter((t) => t.id !== id));

				await syncManager.addToQueue({
					action: 'delete',
					tripId: id
				});

				console.log('✅ Trip moved to trash:', id);
			} catch (err) {
				console.error('❌ Failed to delete trip:', err);
				throw err;
			}
		},

		async get(id: string, userId: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('trips', 'readonly');
				const trip = await tx.objectStore('trips').get(id);
				if (!trip || trip.userId !== userId) return null;
				return trip;
			} catch (err) {
				console.error('❌ Failed to get trip:', err);
				return null;
			}
		},

		clear() {
			set([]);
		},

		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) return;
				const response = await fetch('/api/trips');
				if (!response.ok) throw new Error('Failed to fetch trips');
				const cloudTrips = await response.json();
				
				const db = await getDB();

				const trashTx = db.transaction('trash', 'readonly');
				const trashStore = trashTx.objectStore('trash');
				const trashItems = await trashStore.getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));
				await trashTx.done;

				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');
				
				for (const cloudTrip of cloudTrips) {
					if (trashIds.has(cloudTrip.id)) {
						console.log('Skipping synced trip because it is in local trash:', cloudTrip.id);
						continue;
					}

					const local = await store.get(cloudTrip.id);
					if (!local || new Date(cloudTrip.updatedAt) > new Date(local.updatedAt)) {
						await store.put({
							...cloudTrip,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}
				await tx.done;
				await this.load(userId);
			} catch (err) {
				console.error('❌ Failed to sync from cloud:', err);
			}
		},

		async migrateOfflineTrips(tempUserId: string, realUserId: string) {
			if (!tempUserId || !realUserId || tempUserId === realUserId) return;
			const db = await getDB();
			const tx = db.transaction('trips', 'readwrite');
			const store = tx.objectStore('trips');
			const index = store.index('userId');
			const offlineTrips = await index.getAll(tempUserId);
			for (const trip of offlineTrips) {
				trip.userId = realUserId;
				trip.syncStatus = 'pending';
				trip.updatedAt = new Date().toISOString();
				await store.put(trip);
				await syncManager.addToQueue({ action: 'create', tripId: trip.id, data: trip });
			}
			await tx.done;
			await this.load(realUserId);
		}
	};
}

export const trips = createTripsStore();

function createDraftStore() {
	const { subscribe, set } = writable(storage.getDraftTrip());
	return {
		subscribe,
		save: (data: any) => {
			storage.saveDraftTrip(data);
			set(data);
		},
		load: () => storage.getDraftTrip(),
		clear: () => {
			storage.clearDraftTrip();
			set(null);
		}
	};
}

export const draftTrip = createDraftStore();