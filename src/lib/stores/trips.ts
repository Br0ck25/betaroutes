// src/lib/stores/trips.ts
import { writable, get } from 'svelte/store';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TripRecord, TrashRecord, MileageRecord } from '$lib/db/types';
import { storage } from '$lib/utils/storage';
import { user as authUser } from '$lib/stores/auth';
import { userSettings } from '$lib/stores/userSettings';
import type { User } from '$lib/types';
import { PLAN_LIMITS } from '$lib/constants';
import { csrfFetch } from '$lib/utils/csrf';
import { SvelteDate } from '$lib/utils/svelte-reactivity';

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
				// If trip doesn't exist in the store, add it (for restore from trash)
				return [trip, ...items];
			});
		},
		// ... (keep load, create, updateTrip exactly as they are) ...
		async load(userId?: string) {
			// ... copy existing load code ...
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
				const dbRW = db.transaction('trips', 'readwrite');
				const storeRW = dbRW.objectStore('trips');
				for (const t of trips) {
					if (t.totalMiles == null && (t as TripRecord)['totalMileage'] != null) {
						(t as TripRecord).totalMiles = Number((t as TripRecord)['totalMileage']) || 0;
						(t as TripRecord).syncStatus = 'pending';
						(t as TripRecord).updatedAt = SvelteDate.now().toISOString();
						(t as TripRecord)['lastModified'] = SvelteDate.now().toISOString();
						await storeRW.put(t);
					}
				}
				await dbRW.done;
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
			// ... copy existing create code ...
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
					const cutoffMs = SvelteDate.now().getTime() - windowMs;
					const recentCount = allUserTrips.filter((t) => {
						const dMs = SvelteDate.from(t.date || t.createdAt).getTime();
						return dMs >= cutoffMs;
					}).length;
					const allowed =
						PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10;
					if (recentCount >= allowed) {
						throw new Error(`Free tier limit reached (${allowed} trips per ${windowDays} days).`);
					}
				}
				const now = SvelteDate.now().toISOString();
				const normalizedStops = (tripData.stops || []).map((s: unknown, i) => {
					const st = s as Record<string, unknown>;
					return {
						id: String(st['id'] ?? crypto.randomUUID()),
						address: String(st['address'] ?? ''),
						earnings: Number(st['earnings'] ?? 0) || 0,
						notes: (st['notes'] as string) || '',
						order: typeof st['order'] === 'number' ? (st['order'] as number) : i,
						distanceFromPrev: Number(st['distanceFromPrev'] ?? 0) || 0,
						timeFromPrev: Number(st['timeFromPrev'] ?? 0) || 0
					};
				});
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
				// Enqueue trip sync - mileage creation is handled server-side
				try {
					await syncManager.addToQueue({
						action: 'create',
						tripId: trip.id,
						data: { ...trip, store: 'trips' }
					});
				} catch (err) {
					console.warn('Failed to enqueue trip for sync:', err);
				}
				// NOTE: Mileage log creation is handled server-side in POST /api/trips
				// to ensure a single source of truth and include user settings
				return trip;
			} catch (err) {
				console.error('❌ Failed to create trip:', err);
				throw err;
			}
		},
		async updateTrip(id: string, changes: Partial<TripRecord>, userId: string) {
			// ... copy existing updateTrip code ...
			try {
				const db = await getDB();
				const tx = db.transaction('trips', 'readwrite');
				const store = tx.objectStore('trips');
				const existing = await store.get(id);
				if (!existing) throw new Error('Trip not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');
				const now = SvelteDate.now().toISOString();
				const normalizedStops = (changes.stops || existing.stops || []).map(
					(s: unknown, i: number) => {
						const st = s as Record<string, unknown>;
						return {
							id: String(st['id'] ?? crypto.randomUUID()),
							address: String(st['address'] ?? ''),
							earnings: Number(st['earnings'] ?? 0) || 0,
							notes: (st['notes'] as string) || '',
							order: typeof st['order'] === 'number' ? (st['order'] as number) : i,
							distanceFromPrev: Number(st['distanceFromPrev'] ?? 0) || 0,
							timeFromPrev: Number(st['timeFromPrev'] ?? 0) || 0
						};
					}
				);
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
				try {
					if (Object.prototype.hasOwnProperty.call(changes, 'totalMiles')) {
						const { mileage } = await import('$lib/stores/mileage');
						const existingMileage = await mileage.get(id, userId);

						if (existingMileage) {
							// Update existing mileage record
							await mileage.updateMileage(
								id,
								{ miles: Number((changes as Partial<TripRecord>).totalMiles ?? 0) },
								userId
							);
						} else if (Number((changes as Partial<TripRecord>).totalMiles ?? 0) > 0) {
							// Create new mileage record if none exists and miles > 0
							await mileage.create(
								{
									id,
									tripId: id,
									miles: Number((changes as Partial<TripRecord>).totalMiles ?? 0),
									date: updated.date,
									mileageRate:
										(get(userSettings) as unknown as { mileageRate?: number })?.mileageRate ??
										undefined,
									vehicle:
										(
											get(userSettings) as unknown as {
												vehicles?: Array<{ id?: string; name?: string }>;
											}
										)?.vehicles?.[0]?.id ??
										(
											get(userSettings) as unknown as {
												vehicles?: Array<{ id?: string; name?: string }>;
											}
										)?.vehicles?.[0]?.name ??
										undefined,
									createdAt: updated.createdAt,
									updatedAt: updated.updatedAt
								},
								userId
							);
						}
					}
				} catch (err) {
					console.warn('Failed to mirror trip mileage to local mileage store:', err);
				}
				return updated;
			} catch (err) {
				console.error('❌ Failed to update trip:', err);
				throw err;
			}
		},

		// [!code focus] THE FIX IS HERE
		async deleteTrip(id: string, userId: string) {
			let previousTrips: TripRecord[] = [];
			update((current) => {
				previousTrips = current;
				return current.filter((t) => t.id !== id);
			});

			try {
				const db = await getDB();
				const tripsTx = db.transaction('trips', 'readonly');
				const trip = await tripsTx.objectStore('trips').get(id);
				if (!trip) throw new Error('Trip not found');
				if (trip.userId !== userId) throw new Error('Unauthorized');

				const now = SvelteDate.now().toDate();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

				// Prepare trip trash item
				// We use "trip:" prefix to ensure it never collides with mileage logs
				const trashItem: TrashRecord = {
					...(trip as Partial<TripRecord>),
					id: `trip:${id}`,
					originalId: id,
					userId: trip.userId,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					originalKey: `trip:${userId}:${id}`,
					syncStatus: 'pending',
					recordType: 'trip',
					backups: { trip: { ...trip } }
				};

				// Check and capture mileage - create SEPARATE trash item for mileage
				const mileageStoreName = getMileageStoreName(db);
				const mileageTx = db.transaction(mileageStoreName, 'readwrite');
				const activeMileage = await mileageTx.objectStore(mileageStoreName).get(id);
				let mileageTrashItem: TrashRecord | null = null;
				if (activeMileage) {
					// Store mileage backup in trip item for reference
					(trashItem as Record<string, unknown>)['backups'] = {
						...((trashItem as Record<string, unknown>)['backups'] || {}),
						mileage: { ...activeMileage }
					};
					// Also store top-level props for easy UI display
					(trashItem as Record<string, unknown>)['miles'] = activeMileage.miles;
					(trashItem as Record<string, unknown>)['vehicle'] = activeMileage.vehicle;

					// Create SEPARATE trash item for mileage so user can restore it independently
					mileageTrashItem = {
						...(activeMileage as Partial<MileageRecord>),
						id: `mileage:${id}`,
						originalId: id,
						userId: activeMileage.userId,
						deletedAt: now.toISOString(),
						deletedBy: userId,
						expiresAt: expiresAt.toISOString(),
						originalKey: `mileage:${userId}:${id}`,
						syncStatus: 'pending',
						recordType: 'mileage',
						tripId: id,
						backups: { mileage: { ...activeMileage } }
					};
					// Delete from active store
					await mileageTx.objectStore(mileageStoreName).delete(id);
				}
				await mileageTx.done;
				// Save trash items (trip and optionally mileage)
				const trashTx = db.transaction('trash', 'readwrite');
				await trashTx.objectStore('trash').put(trashItem);
				if (mileageTrashItem) {
					await trashTx.objectStore('trash').put(mileageTrashItem);
				}
				await trashTx.done;

				// Delete from active trips
				const delTx = db.transaction('trips', 'readwrite');
				await delTx.objectStore('trips').delete(id);
				await delTx.done;

				// Only enqueue server sync if client is authenticated as the same user to avoid 401s
				const currentUser = get(authUser) as User | null;
				if (currentUser && currentUser.id && currentUser.id === trip.userId) {
					await syncManager.addToQueue({ action: 'delete', tripId: id });
				} else {
					// Skip server sync for unauthenticated/offline users. Sync will occur when a valid session is available.
				}
			} catch (err) {
				console.error('❌ Failed to delete trip:', err);
				set(previousTrips);
				throw err;
			}
		},

		// ... (keep get, clear, syncFromCloud, syncPendingToCloud, migrateOfflineTrips) ...
		async get(id: string, userId: string) {
			// ... copy existing get code ...
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
			// ... copy existing syncFromCloud code ...
			isLoading.set(true);
			try {
				if (!navigator.onLine) return;
				const lastSync = storage.getLastSync();
				let url = '/api/trips';
				if (lastSync) {
					try {
						const adjusted = new Date(lastSync);
						adjusted.setMinutes(adjusted.getMinutes() - 5);
						const now = new Date();
						if (adjusted.getTime() > now.getTime()) {
							adjusted.setTime(now.getTime() - 5 * 60 * 1000);
						}
						url = `/api/trips?since=${encodeURIComponent(adjusted.toISOString())}`;
					} catch {
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
					// Check simple ID AND prefixed ID to be safe
					if (trashIds.has(cloudTrip.id) || trashIds.has(`trip:${cloudTrip.id}`)) continue;
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
			// ... copy existing syncPendingToCloud code ...
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
						const response = await csrfFetch('/api/trips', {
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
			// ... copy existing migrateOfflineTrips code ...
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

syncManager.registerStore('trips', {
	updateLocal: (trip: unknown) => trips.updateLocal(trip as TripRecord),
	syncDown: async () => {
		const user = get(authUser) as User | null;
		if (user?.id) await trips.syncFromCloud(user.id);
	}
});

function createDraftStore() {
	const { subscribe, set } = writable<Partial<import('$lib/types').Trip> | null>(
		storage.getDraftTrip()
	);
	return {
		subscribe,
		save: (data: Partial<import('$lib/types').Trip>) => {
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
