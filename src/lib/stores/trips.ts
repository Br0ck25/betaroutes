// src/lib/stores/trips.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord } from '$lib/db/types';
import { storage } from '$lib/utils/storage';
import { user as authUser } from '$lib/stores/auth';
import type { User } from '$lib/types';
import { PLAN_LIMITS } from '$lib/constants';

export const isLoading = writable(false);

function createTripsStore() {
	const { subscribe, set, update } = writable<TripRecord[]>([]);

	return {
		subscribe,

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

				trips.sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});

				// Migration: Normalize totalMileage -> totalMiles
				const dbRW = db.transaction('trips', 'readwrite');
				const storeRW = dbRW.objectStore('trips');
				let migrated = 0;
				for (const t of trips) {
					if ((t as any).totalMiles == null && (t as any).totalMileage != null) {
						(t as any).totalMiles = Number((t as any).totalMileage) || 0;
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
				const currentUser = get(authUser) as User | null;
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

// Normalize stops and numeric fields to match DB schema
		const normalizedStops = (tripData.stops || []).map((s: any, i) => ({
			id: String(s.id || crypto.randomUUID()),
			address: String(s.address || ''),
			earnings: Number(s.earnings) || 0,
			notes: s.notes || '',
			order: typeof s.order === 'number' ? s.order : i,
			distanceFromPrev: Number(s.distanceFromPrev) || 0,
			timeFromPrev: Number(s.timeFromPrev) || 0
		}));

		const trip: TripRecord = {
			...tripData,
			stops: normalizedStops,
					id: tripData.id || crypto.randomUUID(),
					userId,
					createdAt: tripData.createdAt || now,
					updatedAt: tripData.updatedAt || now,
					lastModified: now,
					syncStatus: 'pending'
				} as TripRecord;

				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				await tx.objectStore('trips').put(trip);
				await tx.done;

				update((trips) => {
					const exists = trips.find((t) => t.id === trip.id);
					if (exists) return trips.map((t) => (t.id === trip.id ? trip : t));
					return [trip, ...trips];
				});

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

const normalizedStops = (changes.stops || existing.stops || []).map((s: any, i: number) => ({
			id: String(s.id || crypto.randomUUID()),
			address: String(s.address || ''),
			earnings: Number(s.earnings) || 0,
			notes: s.notes || '',
			order: typeof s.order === 'number' ? s.order : i,
			distanceFromPrev: Number(s.distanceFromPrev) || 0,
			timeFromPrev: Number(s.timeFromPrev) || 0
		}));
		const updated: TripRecord = {
			...existing,
			...changes,
			stops: normalizedStops,
					id,
					userId,
					updatedAt: now,
					lastModified: now,
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
			let previousTrips: TripRecord[] = [];
			update((current) => {
				previousTrips = current;
				return current.filter((t) => t.id !== id);
			});

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

				await syncManager.addToQueue({
					action: 'delete',
					tripId: id
				});

				console.log('✅ Trip moved to trash:', id);
			} catch (err) {
				console.error('❌ Failed to delete trip:', err);
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
				// Add a small buffer to compensate for device clock skew (5 minutes)
				let url = '/api/trips';
				if (lastSync) {
					try {
						const adjusted = new Date(lastSync);
						adjusted.setMinutes(adjusted.getMinutes() - 5); // 5-minute buffer
						// If the adjusted time is in the future (device clock skew ahead), clamp it to now - 5 minutes
						const now = new Date();
						if (adjusted.getTime() > now.getTime()) {
							console.warn(
								'[trips.syncFromCloud] lastSync is in the future; clamping to now - 5min',
								{
									lastSync,
									clamped: new Date(now.getTime() - 5 * 60 * 1000).toISOString()
								}
							);
							adjusted.setTime(now.getTime() - 5 * 60 * 1000);
						}
						url = `/api/trips?since=${encodeURIComponent(adjusted.toISOString())}`;
					} catch {
						// If parsing fails, fall back to raw lastSync
						url = `/api/trips?since=${encodeURIComponent(lastSync)}`;
					}
				}
				console.log(`☁️ Syncing trips... ${lastSync ? `(Delta since ${lastSync})` : '(Full)'}`);

				const response = await fetch(url, { credentials: 'include' });
				if (!response.ok) throw new Error('Failed to fetch trips');

				const cloudTrips: unknown[] = (await response.json()) as unknown[];

				if (cloudTrips.length === 0) {
					console.log('☁️ No new trip changes.');
					storage.setLastSync(new Date().toISOString());
					return;
				}

				const db = await getDB();

				const trashTx = db.transaction('trash', 'readonly');
				const trashStore = trashTx.objectStore('trash');
				const trashItems = await trashStore.getAll();
				const trashIds = new Set(trashItems.map((t: { id: string }) => t.id));

				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');
				let updateCount = 0;
				let deleteCount = 0;

				for (const cloudTripRaw of cloudTrips) {
					const cloudTrip = cloudTripRaw as unknown as {
						id?: string;
						updatedAt?: string;
						deleted?: boolean;
					};
					if (!cloudTrip.id) continue;
					if (trashIds.has(cloudTrip.id)) continue;

					const local = await store.get(cloudTrip.id);
					if (!local || new Date(cloudTrip.updatedAt || '') > new Date(local.updatedAt || '')) {
						if (cloudTrip.deleted) {
							await store.delete(cloudTrip.id);
							deleteCount++;
						} else {
							await store.put({
								...(cloudTrip as object),
								syncStatus: 'synced',
								lastSyncedAt: new Date().toISOString()
							});
							updateCount++;
						}
					}
				}

				await tx.done;

				storage.setLastSync(new Date().toISOString());
				console.log(`✅ Synced trips. Updated: ${updateCount}, Deleted: ${deleteCount}.`);

				await this.load(userId);
			} catch (err) {
				console.error('❌ Failed to sync trips from cloud:', err);
			} finally {
				isLoading.set(false);
			}
		},

		async syncPendingToCloud(userId: string) {
			try {
				if (!navigator.onLine) return { synced: 0, failed: 0 };

				console.log('⬆️ Syncing pending local changes...');

				const db = await getDB();
				const tx = db.transaction('trips', 'readonly');
				const index = tx.objectStore('trips').index('userId');
				const allTrips = await index.getAll(userId);
				await tx.done;

				const pendingTrips = allTrips.filter((t) => t.syncStatus === 'pending');

				if (pendingTrips.length === 0) return { synced: 0, failed: 0 };

				console.log(`📤 Uploading ${pendingTrips.length} pending trip(s)...`);

				let synced = 0;
				let failed = 0;

				for (const trip of pendingTrips) {
					try {
						const method = trip.createdAt !== trip.updatedAt ? 'PUT' : 'POST';
						const response = await fetch('/api/trips', {
							method,
							credentials: 'include'
						});

						if (response.ok) {
							const updateTx = db.transaction('trips', 'readwrite');
							const updatedTrip = { ...trip, syncStatus: 'synced' as const };
							await updateTx.objectStore('trips').put(updatedTrip);
							await updateTx.done;
							synced++;
						} else {
							failed++;
						}
					} catch (err) {
						console.error('Error syncing trip:', trip.id, err);
						failed++;
					}
				}

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

// [!code change] Replaces old setStoreUpdater with registerStore to fix crash
syncManager.registerStore('trips', {
	updateLocal: (trip) => trips.updateLocal(trip),
	syncDown: async () => {
		const user = get(authUser) as User | null;
		if (user?.id) await trips.syncFromCloud(user.id);
	}
});

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
