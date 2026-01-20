// src/lib/stores/mileage.ts
import { writable, get } from 'svelte/store';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { MileageRecord } from '$lib/db/types';
import type { User } from '$lib/types';
import { auth } from '$lib/stores/auth';
import { calculateFuelCost } from '$lib/utils/calculations';

export const isLoading = writable(false);

// Type for trash items to avoid repeated `as any` casts
interface TrashItemLike {
	id?: string;
	deletedAt?: string;
	metadata?: { deletedAt?: string };
}

// Helper to build a map of trash IDs to their deletedAt timestamps
function buildTrashTimestampMap(trashItems: TrashItemLike[]): Map<string, string> {
	const trashMap = new Map<string, string>();
	for (const t of trashItems) {
		const tid = t.id;
		const deletedAt = t.deletedAt || t.metadata?.deletedAt;
		if (tid && deletedAt) trashMap.set(tid, deletedAt);
	}
	return trashMap;
}

// Helper to check if a mileage record should be filtered out based on trash entries
// Accepts just the id and createdAt to avoid needing a full MillageRecord
function shouldFilterOutMileage(
	id: string,
	createdAt: string,
	trashMap: Map<string, string>
): boolean {
	const rawTrashDeletedAt = trashMap.get(id);
	const prefixedTrashDeletedAt = trashMap.get(`mileage:${id}`);
	const trashDeletedAt = rawTrashDeletedAt || prefixedTrashDeletedAt;

	// If not in trash at all, don't filter out
	if (!trashDeletedAt) return false;

	// If in trash, check if this item was created AFTER the trash item was deleted
	const itemCreatedAt = new Date(createdAt).getTime();
	const deletedTime = new Date(trashDeletedAt).getTime();

	// If item was created after the trash entry, it's a new record - don't filter out
	if (itemCreatedAt > deletedTime) return false;

	// Otherwise, filter out this item (it's the deleted one)
	return true;
}

function createMileageStore() {
	const { subscribe, set, update } = writable<MileageRecord[]>([]);
	let _hydrationPromise: Promise<void> | null = null;
	let _resolveHydration: any = null;
	void _hydrationPromise;
	void _resolveHydration;

	return {
		subscribe,
		set,
		// ... (keep hydrate, updateLocal, load, create, updateMillage as they are) ...
		async hydrate(data: MileageRecord[], _userId?: string) {
			// ... copy from previous ...
			void _userId;
			_hydrationPromise = new Promise((res) => (_resolveHydration = res));
			set(data);
			if (typeof window === 'undefined') {
				_resolveHydration?.();
				_hydrationPromise = null;
				return;
			}
			try {
				const db = await getDB();
				const trashTx = db.transaction('trash', 'readonly');
				const trashItems = await trashTx.objectStore('trash').getAll();
				const trashMap = buildTrashTimestampMap(trashItems as TrashItemLike[]);
				await trashTx.done;
				const validServerData = data.filter(
					(item) => !shouldFilterOutMileage(item.id, item.createdAt, trashMap)
				);
				const serverIdSet = new Set(validServerData.map((i) => i.id));
				const mileageStoreName = getMileageStoreName(db);
				const tx = db.transaction([mileageStoreName, 'trash'], 'readwrite');
				const store = tx.objectStore(mileageStoreName);
				const localItems = await store.getAll();
				const localById = new Map(localItems.map((item) => [item.id, item]));
				for (const local of localItems) {
					if (shouldFilterOutMileage(local.id, local.createdAt, trashMap)) {
						await store.delete(local.id);
					} else if (local.syncStatus === 'synced' && !serverIdSet.has(local.id)) {
						await store.delete(local.id);
					}
				}
				for (const item of validServerData) {
					const local = localById.get(item.id);
					if (local && local.syncStatus !== 'synced') continue;
					await store.put({ ...item, syncStatus: 'synced' });
				}

				const mergedById = new Map<string, MileageRecord>();
				for (const item of validServerData) {
					mergedById.set(item.id, { ...item, syncStatus: 'synced' });
				}
				for (const local of localItems) {
					if (shouldFilterOutMileage(local.id, local.createdAt, trashMap)) continue;
					if (local.syncStatus === 'synced' && !serverIdSet.has(local.id)) continue;
					if (local.syncStatus !== 'synced') {
						const existing = mergedById.get(local.id);
						if (!existing) {
							mergedById.set(local.id, local);
						} else {
							const localUpdated = new Date(local.updatedAt || local.createdAt).getTime();
							const existingUpdated = new Date(existing.updatedAt || existing.createdAt).getTime();
							if (localUpdated >= existingUpdated) {
								mergedById.set(local.id, local);
							}
						}
					}
				}

				const merged = Array.from(mergedById.values()).sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});
				set(merged);
				await tx.done;
				if (_resolveHydration) _resolveHydration();
				_hydrationPromise = null;
			} catch (err) {
				console.error('Failed to hydrate mileage cache:', err);
				_resolveHydration?.();
				_hydrationPromise = null;
			}
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
			// ... copy from previous ...
			isLoading.set(true);
			try {
				const db = await getDB();
				const mileageStoreName = getMileageStoreName(db);
				const tx = db.transaction([mileageStoreName, 'trash'], 'readonly');
				const store = tx.objectStore(mileageStoreName);
				const trashStore = tx.objectStore('trash');
				let items: MileageRecord[];
				if (userId) {
					const index = store.index('userId');
					items = await index.getAll(userId);
				} else {
					items = await store.getAll();
				}
				const trashItems = await trashStore.getAll();
				const trashMap = buildTrashTimestampMap(trashItems as TrashItemLike[]);
				const activeItems = items.filter(
					(item) => !shouldFilterOutMileage(item.id, item.createdAt, trashMap)
				);
				activeItems.sort((a, b) => {
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
			// ... copy from previous ...
			const record: MileageRecord = {
				...data,
				id: data.id || crypto.randomUUID(),
				userId,
				date: data.date || new Date().toISOString(),
				startOdometer: (data.startOdometer as number) || 0,
				endOdometer: (data.endOdometer as number) || 0,
				miles:
					typeof data.miles === 'number'
						? data.miles
						: Math.max(0, Number(data.endOdometer) - Number(data.startOdometer)),
				mileageRate: typeof data.mileageRate === 'number' ? data.mileageRate : undefined,
				vehicle: data.vehicle || undefined,
				reimbursement: typeof data.reimbursement === 'number' ? data.reimbursement : undefined,
				notes: data.notes || '',
				createdAt: data.createdAt || new Date().toISOString(),
				updatedAt: data.updatedAt || new Date().toISOString(),
				syncStatus: 'pending'
			};
			if (typeof record.reimbursement !== 'number') {
				let rate: number | undefined = record.mileageRate;
				if (rate == null) {
					try {
						const { userSettings } = await import('$lib/stores/userSettings');
						rate = (userSettings && (userSettings as any).mileageRate) || undefined;
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
				const mileageStoreName = getMileageStoreName(db);
				const tx = db.transaction(mileageStoreName, 'readwrite');
				await tx.objectStore(mileageStoreName).put(record);
				await tx.done;
				await syncManager.addToQueue({
					action: 'create',
					tripId: record.id,
					data: { ...record, store: 'mileage' }
				});
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
			try {
				const db = await getDB();
				const mileageStoreName = getMileageStoreName(db);
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
							const { userSettings } = await import('$lib/stores/userSettings');
							rate = (userSettings && (userSettings as any).mileageRate) || undefined;
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
					const trip = await tripStore.get(id as any);
					if (trip && trip.userId === userId) {
						const nowIso = new Date().toISOString();
						// Recalculate fuelCost based on new miles
						const newMiles = updated.miles || 0;
						const mpg = trip.mpg || 25;
						const gasPrice = trip.gasPrice || 3.5;
						const newFuelCost = calculateFuelCost(newMiles, mpg, gasPrice);
						const patched = {
							...trip,
							totalMiles: newMiles,
							fuelCost: newFuelCost,
							updatedAt: nowIso,
							syncStatus: 'pending'
						} as any;
						await tripStore.put(patched);
						try {
							const { trips } = await import('$lib/stores/trips');
							trips.updateLocal({
								id,
								totalMiles: newMiles,
								fuelCost: newFuelCost,
								updatedAt: nowIso
							} as any);
						} catch {
							/* ignore */
						}
					}
					await tripsTx.done;
				} catch {
					/* ignore */
				}
				await syncManager.addToQueue({
					action: 'update',
					tripId: id,
					data: { ...updated, store: 'mileage' }
				});
				return updated;
			} catch (err) {
				console.error('❌ Failed to update mileage:', err);
				this.load(userId);
				throw err;
			}
		},

		// [!code focus] THE FIX IS HERE
		async deleteMileage(id: string, userId: string) {
			let previous: MileageRecord[] = [];
			update((current) => {
				previous = current;
				return current.filter((r) => r.id !== id);
			});

			try {
				const db = await getDB();
				const mileageStoreName = getMileageStoreName(db);
				const tx = db.transaction([mileageStoreName, 'trash'], 'readwrite');
				const mileageStore = tx.objectStore(mileageStoreName);
				const trashStore = tx.objectStore('trash');

				const rec = await mileageStore.get(id);
				if (!rec) {
					await tx.done;
					await syncManager.addToQueue({
						action: 'delete',
						tripId: id,
						data: { store: 'mileage' }
					});
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
					tripId: rec.id,
					type: 'mileage',
					recordType: 'mileage',
					data: rec,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					originalKey: `mileage:${userId}:${id}`,
					syncStatus: 'pending',
					miles: rec.miles,
					vehicle: rec.vehicle,
					date: rec.date,
					backups: { mileage: { ...rec } }
				};

				await trashStore.put(trashItem as any);
				await mileageStore.delete(id);

				// Update trip to 0 miles and 0 fuelCost
				try {
					const tripsTx = db.transaction('trips', 'readwrite');
					const tripStore = tripsTx.objectStore('trips');
					const trip = await tripStore.get(id as any);
					if (trip && trip.userId === userId) {
						const nowIso = new Date().toISOString();
						const patched = {
							...trip,
							totalMiles: 0,
							fuelCost: 0,
							updatedAt: nowIso,
							syncStatus: 'pending'
						} as any;
						await tripStore.put(patched);
						try {
							const { trips } = await import('$lib/stores/trips');
							trips.updateLocal({ id, totalMiles: 0, fuelCost: 0, updatedAt: nowIso } as any);
						} catch {
							/* ignore */
						}

						await syncManager.addToQueue({
							action: 'update',
							tripId: id,
							data: { ...patched, store: 'trips', skipEnrichment: true }
						});
					}
					await tripsTx.done;
				} catch {
					/* ignore */
				}

				await syncManager.addToQueue({ action: 'delete', tripId: id, data: { store: 'mileage' } });
				return;
			} catch (err) {
				console.error('❌ Failed to delete mileage record:', err);
				set(previous);
				throw err;
			}
		},

		// ... (keep get, clear, syncFromCloud, migrateOfflineMillage) ...
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
				const cloud: any = await response.json();
				if (cloud.length > 0) {
					const db = await getDB();
					const tx = db.transaction(['mileage', 'trash'], 'readwrite');
					const store = tx.objectStore('mileage');
					const trashStore = tx.objectStore('trash');
					const trashItems = await trashStore.getAll();
					const trashMap = buildTrashTimestampMap(trashItems as TrashItemLike[]);
					for (const rec of cloud) {
						if (rec.deleted) {
							const local = await store.get(rec.id);
							if (local) await store.delete(rec.id);
							continue;
						}
						// Check if this record should be filtered out based on trash entries
						if (shouldFilterOutMileage(rec.id, rec.createdAt, trashMap)) {
							continue; // Skip - this is the deleted record
						}

						const local = await store.get(rec.id);
						if (!local || new Date(rec.updatedAt) > new Date(local.updatedAt)) {
							await store.put({
								...rec,
								syncStatus: 'synced',
								lastSyncedAt: new Date().toISOString()
							});
						}
					}
					await tx.done;
				}
				localStorage.setItem('last_sync_millage', new Date().toISOString());
			} catch (err) {
				console.error('❌ Failed to sync mileage from cloud:', err);
			} finally {
				if (_hydrationPromise) await _hydrationPromise;
				await this.load(userId);
				isLoading.set(false);
			}
		},
		async migrateOfflineMileage(tempUserId: string, realUserId: string) {
			// ... copy existing migrateOfflineMillage code ...
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
		if (item && typeof (item as any).miles === 'number') {
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
		save: (data: any) => {
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
