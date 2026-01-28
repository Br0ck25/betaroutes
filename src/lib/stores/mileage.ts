// src/lib/stores/mileage.ts
import { PLAN_LIMITS } from '$lib/constants';
import type { AppDB } from '$lib/db/indexedDB';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import type { MileageRecord, TrashRecord, TripRecord } from '$lib/db/types';
import { auth } from '$lib/stores/auth';
import { syncManager } from '$lib/sync/syncManager';
import type { User } from '$lib/types';
import { calculateFuelCost } from '$lib/utils/calculations';
import type { IDBPDatabase } from 'idb';
import { get, writable } from 'svelte/store';

export const isLoading = writable(false);

function resolveMileageStoreName(db: IDBPDatabase<AppDB>): 'mileage' | 'millage' {
	return typeof getMileageStoreName === 'function' ? getMileageStoreName(db) : 'mileage';
}

// Type for trash items to avoid repeated `as any` casts
interface TrashItemLike {
	id?: string;
	deletedAt?: string;
	metadata?: { deletedAt?: string };
}

function createMileageStore() {
	const { subscribe, set, update } = writable<MileageRecord[]>([]);
	let _hydrationPromise: Promise<void> | null = null;
	let _resolveHydration: (() => void) | null = null;

	return {
		subscribe,
		set,
		// Optimized hydrate: Set data immediately, defer IndexedDB work
		async hydrate(data: MileageRecord[], _userId?: string) {
			void _userId;
			_hydrationPromise = new Promise((res) => (_resolveHydration = res));

			// PERFORMANCE: Set data immediately for instant UI response
			const normalizedData = data
				.map((item) => ({
					...item,
					syncStatus: (item as MileageRecord).syncStatus ?? 'synced'
				}))
				.sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});
			set(normalizedData);

			if (typeof window === 'undefined') {
				_resolveHydration?.();
				_hydrationPromise = null;
				return;
			}

			// PERFORMANCE: Do IndexedDB sync in background without blocking UI
			// For tests, skip background IndexedDB sync to avoid idb interactions and noisy warnings.
			if (import.meta.env.MODE === 'test') {
				_resolveHydration?.();
				_hydrationPromise = null;
				return;
			}
			setTimeout(async () => {
				try {
					const db = await getDB();
					const mileageStoreName = resolveMileageStoreName(db);
					const tx = db.transaction(mileageStoreName, 'readwrite');
					const store = tx.objectStore(mileageStoreName);

					// Batch write server data
					for (const item of normalizedData) {
						await store.put(item);
					}

					await tx.done;
				} catch (err) {
					console.error('Background hydration failed:', err);
				}
				_resolveHydration?.();
				_hydrationPromise = null;
			}, 0);
		},
		updateLocal(record: MileageRecord) {
			// ... copy from previous ...
			update((items) => {
				const index = items.findIndex((r) => r.id === record.id);
				if (index !== -1) {
					const newItems = [...items];
					newItems[index] = { ...newItems[index], ...record };
					return newItems;
				} else {
					return [record, ...items].sort(
						(a, b) =>
							new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
					);
				}
			});
		},
		async load(userId?: string) {
			isLoading.set(true);
			try {
				const db = await getDB();
				const mileageStoreName = resolveMileageStoreName(db);
				// PERFORMANCE: Use single transaction and build trash set efficiently
				const tx = db.transaction([mileageStoreName, 'trash'], 'readonly');
				const store = tx.objectStore(mileageStoreName);
				const trashStore = tx.objectStore('trash');

				// Fetch in parallel
				const [items, trashItems] = await Promise.all([
					userId ? store.index('userId').getAll(userId) : store.getAll(),
					trashStore.getAll()
				]);

				// PERFORMANCE: Build trash set once with both ID formats
				const trashIds = new Set<string>();
				for (const t of trashItems) {
					const id = (t as TrashItemLike).id;
					if (id) {
						trashIds.add(id);
						if (id.startsWith('mileage:')) {
							trashIds.add(id.replace('mileage:', ''));
						} else {
							trashIds.add(`mileage:${id}`);
						}
					}
				}

				// PERFORMANCE: Filter and sort in one pass
				const activeItems = items
					.filter((item) => !trashIds.has(item.id))
					.sort((a, b) => {
						const dateA = new Date(a.date || a.createdAt).getTime();
						const dateB = new Date(b.date || b.createdAt).getTime();
						return dateB - dateA;
					});

				set(activeItems);
				return activeItems;
			} catch (err) {
				console.error('❌ Failed to load mileage:', err);
				set([]);
				return [];
			} finally {
				isLoading.set(false);
			}
		},
		async create(data: Partial<MileageRecord>, userId: string) {
			// --- CHECK FREE TIER LIMITS ---
			const currentUser = get(auth).user as User | null;
			const isFreeTier = !currentUser?.plan || currentUser.plan === 'free';

			if (isFreeTier) {
				const db = await getDB();
				const tx = db.transaction('mileage', 'readonly');
				const index = tx.objectStore('mileage').index('userId');
				const allUserMileage = await index.getAll(userId);
				const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
				const windowMs = windowDays * 24 * 60 * 60 * 1000;
				const cutoff = new Date(Date.now() - windowMs);
				const recentCount = allUserMileage.filter((m) => {
					const d = new Date(m.date || m.createdAt);
					return d >= cutoff;
				}).length;
				const allowed =
					PLAN_LIMITS.FREE.MAX_MILEAGE_PER_MONTH || PLAN_LIMITS.FREE.MAX_MILEAGE_IN_WINDOW || 10;

				if (recentCount >= allowed) {
					throw new Error(
						`Free tier limit reached (${allowed} mileage logs per ${windowDays} days).`
					);
				}
			}

			// ... copy from previous ...
			const base: Partial<MileageRecord> = {
				id: data.id || crypto.randomUUID(),
				userId,
				date: data.date || new Date().toISOString(),
				startOdometer: (data.startOdometer as number) || 0,
				endOdometer: (data.endOdometer as number) || 0,
				miles:
					typeof data.miles === 'number'
						? data.miles
						: Math.max(0, Number(data.endOdometer) - Number(data.startOdometer)),
				notes: data.notes || '',
				createdAt: data.createdAt || new Date().toISOString(),
				updatedAt: data.updatedAt || new Date().toISOString(),
				syncStatus: 'pending'
			};

			if (typeof data.mileageRate === 'number') base.mileageRate = data.mileageRate;
			if (typeof data.reimbursement === 'number') base.reimbursement = data.reimbursement;
			if (data.vehicle) base.vehicle = data.vehicle;

			const record: MileageRecord = base as MileageRecord;
			if (typeof record.reimbursement !== 'number') {
				let rate: number | undefined = record.mileageRate;
				if (rate == null) {
					try {
						const { userSettings } = await import('$lib/stores/userSettings');
						const settings = get(userSettings);
						rate = typeof settings?.mileageRate === 'number' ? settings.mileageRate : undefined;
					} catch {
						/* ignore */
					}
				}
				if (typeof rate === 'number' && typeof record.miles === 'number') {
					record.reimbursement = Number((record.miles * rate).toFixed(2));
				}
			}
			update((items) => [record, ...items]);
			try {
				const db = await getDB();
				const mileageStoreName = resolveMileageStoreName(db);
				const tx = db.transaction(mileageStoreName, 'readwrite');
				await tx.objectStore(mileageStoreName).put(record);
				await tx.done;
				// PERFORMANCE: Queue sync in background without blocking
				setTimeout(() => {
					syncManager.addToQueue({
						action: 'create',
						tripId: record.id,
						data: { ...record, store: 'mileage' }
					});
				}, 0);
				return record;
			} catch (err) {
				console.error('❌ Failed to create mileage record:', err);
				this.load(userId);
				throw err;
			}
		},
		async updateMileage(id: string, changes: Partial<MileageRecord>, userId: string) {
			// ... copy from previous ...
			update((items) =>
				items.map((r) =>
					r.id === id ? { ...r, ...changes, updatedAt: new Date().toISOString() } : r
				)
			);
			// Prefetch user settings OUTSIDE of the IDB transaction to avoid TransactionInactiveError
			let preFetchedSettings: {
				mileageRate?: number;
				vehicles?: Array<{ id?: string; name?: string }>;
			} | null = null;
			try {
				const mod = await import('$lib/stores/userSettings');
				preFetchedSettings = get(mod.userSettings) as unknown as {
					mileageRate?: number;
					vehicles?: Array<{ id?: string; name?: string }>;
				};
			} catch {
				/* ignore */
			}
			try {
				const db = await getDB();
				const mileageStoreName = resolveMileageStoreName(db);
				const tx = db.transaction(mileageStoreName, 'readwrite');
				const store = tx.objectStore(mileageStoreName);
				const existing = await store.get(id);
				if (!existing) throw new Error('Mileage record not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');
				const updated: MileageRecord = {
					...existing,
					...changes,
					id,
					userId,
					updatedAt: new Date().toISOString(),
					syncStatus: 'pending'
				};
				const odometerUpdated =
					Object.prototype.hasOwnProperty.call(changes, 'startOdometer') ||
					Object.prototype.hasOwnProperty.call(changes, 'endOdometer');
				const milesExplicit = Object.prototype.hasOwnProperty.call(changes, 'miles');
				if (
					odometerUpdated &&
					!milesExplicit &&
					typeof updated.startOdometer === 'number' &&
					typeof updated.endOdometer === 'number'
				) {
					updated.miles = Math.max(0, Number(updated.endOdometer) - Number(updated.startOdometer));
				}
				const milesChanged = Object.prototype.hasOwnProperty.call(changes, 'miles');
				const rateChanged = Object.prototype.hasOwnProperty.call(changes, 'mileageRate');
				const reimbursementExplicit = Object.prototype.hasOwnProperty.call(
					changes,
					'reimbursement'
				);
				if (
					!reimbursementExplicit &&
					(milesChanged || rateChanged) &&
					typeof updated.miles === 'number'
				) {
					let rate = typeof updated.mileageRate === 'number' ? updated.mileageRate : undefined;
					if (rate == null) {
						try {
							const settings = preFetchedSettings;
							rate = typeof settings?.mileageRate === 'number' ? settings.mileageRate : undefined;
						} catch {
							/* ignore */
						}
					}
					if (typeof rate === 'number') {
						updated.reimbursement = Number((updated.miles * rate).toFixed(2));
					}
				}
				await store.put(updated);
				await tx.done;
				try {
					const tripsTx = db.transaction('trips', 'readwrite');
					const tripStore = tripsTx.objectStore('trips');
					const trip = await tripStore.get(id);
					if (trip && trip.userId === userId) {
						const nowIso = new Date().toISOString();
						// Recalculate fuelCost based on new miles
						const newMiles = updated.miles || 0;
						const mpg = trip.mpg ?? 25;
						const gasPrice = trip.gasPrice ?? 3.5;
						const newFuelCost = calculateFuelCost(newMiles, mpg, gasPrice);
						const patched: TripRecord = {
							...(trip as TripRecord),
							totalMiles: newMiles,
							fuelCost: newFuelCost,
							updatedAt: nowIso,
							syncStatus: 'pending'
						};
						await tripStore.put(patched);
						try {
							const { trips } = await import('$lib/stores/trips');
							trips.updateLocal({
								id,
								totalMiles: newMiles,
								fuelCost: newFuelCost,
								updatedAt: nowIso
							} as TripRecord);
						} catch {
							/* ignore */
						}
					}
					await tripsTx.done;
				} catch {
					/* ignore */
				}
				// PERFORMANCE: Queue sync in background without blocking
				setTimeout(() => {
					syncManager.addToQueue({
						action: 'update',
						tripId: id,
						data: { ...updated, store: 'mileage' }
					});
				}, 0);
				return updated;
			} catch (err) {
				console.error('❌ Failed to update mileage:', err);
				this.load(userId);
				throw err;
			}
		},

		async deleteMileage(id: string, userId: string) {
			// PERFORMANCE: Optimistic update - remove from UI immediately
			let previous: MileageRecord[] = [];
			update((current) => {
				previous = current;
				return current.filter((r) => r.id !== id);
			});

			try {
				const db = await getDB();
				const mileageStoreName = resolveMileageStoreName(db);
				const tx = db.transaction([mileageStoreName, 'trash'], 'readwrite');
				const mileageStore = tx.objectStore(mileageStoreName);
				const trashStore = tx.objectStore('trash');

				const rec = await mileageStore.get(id);
				if (!rec) {
					await tx.done;
					// Queue sync in background without blocking
					setTimeout(() => {
						syncManager.addToQueue({
							action: 'delete',
							tripId: id,
							data: { store: 'mileage' }
						});
					}, 0);
					return;
				}
				if (rec.userId !== userId) {
					await tx.done;
					throw new Error('Unauthorized');
				}

				const now = new Date();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

				// Use prefixed ID "mileage:..." to avoid collision
				const trashItem = {
					id: `mileage:${rec.id}`,
					tripId: rec.tripId || undefined,
					type: 'mileage',
					recordType: 'mileage',
					data: rec,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					userId: userId,
					originalKey: `mileage:${userId}:${id}`,
					syncStatus: 'pending',
					miles: rec.miles,
					vehicle: rec.vehicle,
					date: rec.date,
					backups: { mileage: { ...rec } }
				};

				await trashStore.put(trashItem as TrashRecord);
				await mileageStore.delete(id);

				// Update linked trip (if any) to 0 miles and 0 fuelCost
				try {
					const tripsTx = db.transaction('trips', 'readwrite');
					const tripStore = tripsTx.objectStore('trips');
					const tripIdToUpdate =
						typeof rec.tripId === 'string' && rec.tripId ? (rec.tripId as string) : id;
					if (tripIdToUpdate) {
						const trip = await tripStore.get(tripIdToUpdate);
						if (trip && trip.userId === userId) {
							const nowIso = new Date().toISOString();
							const patched = {
								...trip,
								totalMiles: 0,
								fuelCost: 0,
								updatedAt: nowIso,
								syncStatus: 'pending'
							} as TripRecord;
							await tripStore.put(patched);
							try {
								const { trips } = await import('$lib/stores/trips');
								trips.updateLocal({
									id: tripIdToUpdate,
									totalMiles: 0,
									fuelCost: 0,
									updatedAt: nowIso
								} as TripRecord);
							} catch {
								/* ignore */
							}

							await syncManager.addToQueue({
								action: 'update',
								tripId: tripIdToUpdate,
								data: { ...patched, store: 'trips', skipEnrichment: true }
							});
						}
					}
					await tripsTx.done;
				} catch {
					/* ignore */
				}

				// PERFORMANCE: Queue sync in background without blocking UI
				setTimeout(() => {
					syncManager.addToQueue({ action: 'delete', tripId: id, data: { store: 'mileage' } });
				}, 0);
				return;
			} catch (err) {
				console.error('❌ Failed to delete mileage record:', err);
				set(previous);
				throw err;
			}
		},

		// ... (keep get, clear, syncFromCloud, migrateOfflineMileage) ...
		async get(id: string, userId: string) {
			// ... copy existing get code ...
			try {
				const db = await getDB();
				const tx = db.transaction('mileage', 'readonly');
				const item = await tx.objectStore('mileage').get(id);
				if (!item || item.userId !== userId) return null;
				return item;
			} catch {
				return null;
			}
		},
		// Find a mileage record that references a trip via tripId (server-created records may use a different id)
		async findByTripId(tripId: string, userId: string): Promise<MileageRecord | null> {
			try {
				const db = await getDB();
				const tx = db.transaction('mileage', 'readonly');
				const index = tx.objectStore('mileage').index('userId');
				const all = (await index.getAll(userId)) as MileageRecord[];
				const found = all.find((m) => m.tripId === tripId) ?? null;
				return found as MileageRecord | null;
			} catch {
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
				const lastSync = localStorage.getItem('last_sync_mileage');
				const sinceDate = lastSync ? new Date(new Date(lastSync).getTime() - 5 * 60 * 1000) : null;
				const url = sinceDate
					? `/api/mileage?since=${encodeURIComponent(sinceDate.toISOString())}`
					: '/api/mileage';
				const response = await fetch(url, { credentials: 'include' });
				if (!response.ok) throw new Error('Failed to fetch mileage');
				const cloudRaw = await response.json().catch(() => []);
				const cloud = Array.isArray(cloudRaw) ? (cloudRaw as Array<Record<string, unknown>>) : [];
				if (cloud.length > 0) {
					const db = await getDB();
					const tx = db.transaction(['mileage', 'trash'], 'readwrite');
					const store = tx.objectStore('mileage');
					const trashStore = tx.objectStore('trash');
					const trashItems = await trashStore.getAll();
					const trashIds = new Set(trashItems.map((t: TrashItemLike) => t.id || `mileage:${t.id}`));
					for (const recRaw of cloud) {
						const rec = recRaw as Record<string, unknown>;
						const deleted =
							typeof rec['deleted'] === 'boolean' ? (rec['deleted'] as boolean) : false;
						const recId = typeof rec['id'] === 'string' ? (rec['id'] as string) : undefined;
						if (deleted) {
							if (recId) {
								const local = await store.get(recId);
								if (local) await store.delete(recId);
							}
							continue;
						}
						// Check if this record is in trash (simple ID check)
						if (!recId) continue;
						if (trashIds.has(recId) || trashIds.has(`mileage:${recId}`)) {
							continue; // Skip - this is deleted
						}

						const local = await store.get(recId);
						const recUpdatedAt =
							typeof rec['updatedAt'] === 'string' ? (rec['updatedAt'] as string) : undefined;
						if (!local || (recUpdatedAt && new Date(recUpdatedAt) > new Date(local.updatedAt))) {
							await store.put({
								...rec,
								syncStatus: 'synced',
								lastSyncedAt: new Date().toISOString()
							} as Record<string, unknown>);
						}
					}
					await tx.done;
				}
				// Normalize to correct key name and keep backward compatibility if needed
				localStorage.setItem('last_sync_mileage', new Date().toISOString());
			} catch (err) {
				console.error('❌ Failed to sync mileage from cloud:', err);
			} finally {
				if (_hydrationPromise) await _hydrationPromise;
				await this.load(userId);
				isLoading.set(false);
			}
		},
		async migrateOfflineMileage(tempUserId: string, realUserId: string) {
			// ... copy existing migrateOfflineMileage code ...
			if (!tempUserId || !realUserId || tempUserId === realUserId) return;
			const db = await getDB();
			const tx = db.transaction('mileage', 'readwrite');
			const store = tx.objectStore('mileage');
			const index = store.index('userId');
			const offline = await index.getAll(tempUserId);
			for (const r of offline) {
				r.userId = realUserId;
				r.syncStatus = 'pending';
				r.updatedAt = new Date().toISOString();
				await store.put(r);
				await syncManager.addToQueue({
					action: 'create',
					tripId: r.id,
					data: { ...r, store: 'mileage' }
				});
			}
			await tx.done;
			await this.load(realUserId);
		}
	};
}

export const mileage = createMileageStore();

syncManager.registerStore('mileage', {
	updateLocal: (item) => {
		if (item && typeof (item as Record<string, unknown>)['miles'] === 'number') {
			mileage.updateLocal(item as MileageRecord);
		}
	},
	syncDown: async () => {
		const user = (get(auth) as { user?: User | null }).user;
		if (user?.id) await mileage.syncFromCloud(user.id);
	}
});

function createDraftStore() {
	// ... copy existing createDraftStore code ...
	const STORAGE_KEY = 'draft_mileage';
	const getDraft = () => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			return stored ? JSON.parse(stored) : null;
		} catch {
			return null;
		}
	};
	const { subscribe, set } = writable(getDraft());
	return {
		subscribe,
		save: (data: unknown) => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
			set(data);
		},
		load: () => getDraft(),
		clear: () => {
			localStorage.removeItem(STORAGE_KEY);
			set(null);
		}
	};
}

export const draftMileage = createDraftStore();
