// src/lib/stores/trips.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';
import { storage } from '$lib/utils/storage';
import { auth } from '$lib/stores/auth';
import { PLAN_LIMITS } from '$lib/constants';

export const isLoading = writable(false);

function createTripsStore() {
	const { subscribe, set, update } = writable<TripRecord[]>([]);

	return {
		subscribe,

		// New Method: Updates local store without DB write
		// Used by SyncManager to reflect background changes (like offline calc) in the UI instantly
		updateLocal(trip: TripRecord) {
			update((items) => {
				const index = items.findIndex((t) => t.id === trip.id);
				if (index !== -1) {
					const newItems = [...items];
					newItems[index] = { ...newItems[index], ...trip };
					return newItems;
				}
				return items;
			});
		},

		async load(userId?: string) {
			isLoading.set(true);
			try {
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

				// Sort by date descending (newest first)
				trips.sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});
				// Migration: some older trip records used `totalMileage` instead of `totalMiles`.
				// Normalize to ensure analytics work correctly.
				const dbRW = db.transaction('trips', 'readwrite');
				const storeRW = dbRW.objectStore('trips');
				let migrated = 0;
				for (const t of trips) {
					if ((t as any).totalMiles == null && (t as any).totalMileage != null) {
						(t as any).totalMiles = Number((t as any).totalMileage) || 0;
						// Mark as pending so sync will upload the normalized field to the server
						(t as any).syncStatus = 'pending';
						(t as any).updatedAt = new Date().toISOString();
						(t as any).lastModified = new Date().toISOString();
						await storeRW.put(t);
						migrated++;
					}
				}
				await dbRW.done;
				if (migrated > 0) console.log(`🔧 Migrated ${migrated} trips: totalMileage -> totalMiles`);
				set(trips);
				return trips;
			} catch (err) {
				console.error('❌ Failed to load trips:', err);
				set([]);
				return [];
			} finally {
				isLoading.set(false);
			}
		},

		async create(tripData: Partial<TripRecord>, userId: string) {
			try {
				// Free Tier Check
				const currentUser = get(auth).user;
				const isFreeTier = !currentUser?.plan || currentUser.plan === 'free';

				if (isFreeTier) {
					const db = await getDB();
					const tx = db.transaction('trips', 'readonly');
					const index = tx.objectStore('trips').index('userId');
					const allUserTrips = await index.getAll(userId);

					const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
					const windowMs = windowDays * 24 * 60 * 60 * 1000;
					const cutoff = new Date(Date.now() - windowMs);

					const recentCount = allUserTrips.filter((t) => {
						const d = new Date(t.date || t.createdAt);
						return d >= cutoff;
					}).length;

					const allowed =
						PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10;
					if (recentCount >= allowed) {
						throw new Error(`Free tier limit reached (${allowed} trips per ${windowDays} days).`);
					}
				}

				const now = new Date().toISOString();

				const trip: TripRecord = {
					...tripData,
					id: tripData.id || crypto.randomUUID(),
					userId,
					createdAt: tripData.createdAt || now,
					updatedAt: tripData.updatedAt || now,
					lastModified: now, // Mark as user-created
					syncStatus: 'pending'
				} as TripRecord;

				// 1. Save to Local DB
				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				await tx.objectStore('trips').put(trip);
				await tx.done;

				// 2. Update Svelte Store immediately
				update((trips) => {
					const exists = trips.find((t) => t.id === trip.id);
					if (exists) return trips.map((t) => (t.id === trip.id ? trip : t));
					return [trip, ...trips];
				});

				// 3. Queue for Sync
				await syncManager.addToQueue({
					action: 'create',
					tripId: trip.id,
					data: trip
				});

				return trip;
			} catch (err) {
				console.error('❌ Failed to create trip:', err);
				throw err;
			}
		},

		async updateTrip(id: string, changes: Partial<TripRecord>, userId: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');

				const existing = await store.get(id);
				if (!existing) throw new Error('Trip not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');

				const now = new Date().toISOString();

				const updated: TripRecord = {
					...existing,
					...changes,
					id,
					userId,
					updatedAt: now,
					lastModified: now, // CRITICAL: Mark this as user-edited for conflict detection
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

				return updated;
			} catch (err) {
				console.error('❌ Failed to update trip:', err);
				throw err;
			}
		},

		async deleteTrip(id: string, userId: string) {
			// Optimistic Update: Remove from UI immediately
			let previousTrips: TripRecord[] = [];
			update((current) => {
				previousTrips = current;
				return current.filter((t) => t.id !== id);
			});

			try {
				console.log('🗑️ Moving trip to trash:', id);
				const db = await getDB();

				// 1. Verify Ownership
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

				// 2. Move to Trash Store
				const trashTx = db.transaction('trash', 'readwrite');
				await trashTx.objectStore('trash').put(trashItem);
				await trashTx.done;

				// 3. Remove from Trips Store
				const deleteTx = db.transaction('trips', 'readwrite');
				await deleteTx.objectStore('trips').delete(id);
				await deleteTx.done;

				// 4. Queue Sync Action
				await syncManager.addToQueue({
					action: 'delete',
					tripId: id
				});

				console.log('✅ Trip moved to trash:', id);
			} catch (err) {
				console.error('❌ Failed to delete trip:', err);
				// Revert UI if failed
				set(previousTrips);
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
			isLoading.set(true);
			try {
				if (!navigator.onLine) return;

				const lastSync = storage.getLastSync();
				const url = lastSync ? `/api/trips?since=${encodeURIComponent(lastSync)}` : '/api/trips';

				console.log(
					`☁️ Syncing from cloud... ${lastSync ? `(Delta since ${lastSync})` : '(Full)'}`
				);

				const response = await fetch(url);
				if (!response.ok) throw new Error('Failed to fetch trips');

				const cloudTrips: any = await response.json();

				if (cloudTrips.length === 0) {
					console.log('☁️ No new changes from cloud.');
					storage.setLastSync(new Date().toISOString());
					return;
				}

				const db = await getDB();

				// Get Trash IDs to prevent reviving deleted items
				const trashTx = db.transaction('trash', 'readonly');
				const trashStore = trashTx.objectStore('trash');
				const trashItems = await trashStore.getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));
				await trashTx.done;

				// Merge Logic
				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');

				let updateCount = 0;
				let deleteCount = 0;

				for (const cloudTrip of cloudTrips) {
					// Handle Soft Deletes (Tombstones)
					if (cloudTrip.deleted) {
						const local = await store.get(cloudTrip.id);
						if (local) {
							await store.delete(cloudTrip.id);
							deleteCount++;
							console.log('🗑️ Applying server deletion for:', cloudTrip.id);
						}
						continue;
					}

					if (trashIds.has(cloudTrip.id)) {
						console.log('Skipping synced trip because it is in local trash:', cloudTrip.id);
						continue;
					}

					const local = await store.get(cloudTrip.id);
					// Last Write Wins (based on updatedAt)
					if (!local || new Date(cloudTrip.updatedAt) > new Date(local.updatedAt)) {
						await store.put({
							...cloudTrip,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
						updateCount++;
					}
				}
				await tx.done;

				storage.setLastSync(new Date().toISOString());
				console.log(
					`✅ Processed ${cloudTrips.length} changes. Updated: ${updateCount}, Deleted: ${deleteCount}.`
				);

				await this.load(userId);
			} catch (err) {
				console.error('❌ Failed to sync from cloud:', err);
			} finally {
				isLoading.set(false);
			}
		},

		async syncPendingToCloud(userId: string) {
			try {
				if (!navigator.onLine) return { synced: 0, failed: 0 };

				console.log('⬆️ Syncing pending local changes to cloud...');

				const db = await getDB();
				const tx = db.transaction('trips', 'readonly');
				const index = tx.objectStore('trips').index('userId');
				const allTrips = await index.getAll(userId);
				await tx.done;

				// Find trips with pending sync status
				const pendingTrips = allTrips.filter((t) => t.syncStatus === 'pending');

				if (pendingTrips.length === 0) {
					console.log('✅ No pending changes to sync');
					return { synced: 0, failed: 0 };
				}

				console.log(`📤 Uploading ${pendingTrips.length} pending trip(s)...`);

				let synced = 0;
				let failed = 0;

				for (const trip of pendingTrips) {
					try {
						// Use PUT if trip already exists in cloud, POST if new
						const method = trip.createdAt !== trip.updatedAt ? 'PUT' : 'POST';
						const response = await fetch('/api/trips', {
							method,
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(trip)
						});

						if (response.ok) {
							// Mark as synced in local DB
							const updateTx = db.transaction('trips', 'readwrite');
							const updatedTrip = { ...trip, syncStatus: 'synced' as const };
							await updateTx.objectStore('trips').put(updatedTrip);
							await updateTx.done;
							synced++;
						} else {
							console.error('Failed to sync trip:', trip.id, await response.text());
							failed++;
						}
					} catch (err) {
						console.error('Error syncing trip:', trip.id, err);
						failed++;
					}
				}

				console.log(`✅ Synced ${synced} trips, ${failed} failed`);
				return { synced, failed };
			} catch (err) {
				console.error('❌ Failed to sync pending changes:', err);
				return { synced: 0, failed: 0 };
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

// Register Store Listener for Background Sync Updates
syncManager.setStoreUpdater((trip) => trips.updateLocal(trip));

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
