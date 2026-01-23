// src/lib/stores/trash.ts
import { writable, get } from 'svelte/store';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';
import { user as authUser } from '$lib/stores/auth';
import type { User } from '$lib/types';
import { isRecordOwner } from '$lib/utils/keys';

function createTrashStore() {
	const { subscribe, set, update } = writable<TrashRecord[]>([]);

	// Ensure we always work with prefixed ID if it exists
	const getRealId = (trashId: string) => {
		if (trashId.startsWith('mileage:')) return trashId.replace('mileage:', '');
		if (trashId.startsWith('trip:')) return trashId.replace('trip:', '');
		if (trashId.startsWith('expense:')) return trashId.replace('expense:', '');
		return trashId;
	};

	// Extract record type from prefixed ID
	const getRecordType = (trashId: string): string | undefined => {
		if (trashId.startsWith('mileage:')) return 'mileage';
		if (trashId.startsWith('trip:')) return 'trip';
		if (trashId.startsWith('expense:')) return 'expense';
		return undefined;
	};

	// Generate a unique trash ID with type prefix to avoid collisions
	const getUniqueTrashId = (item: { id: string; recordType?: string; type?: string }) => {
		const id = item.id;
		const recordType = item.recordType || item.type || 'trip';

		// If ID already has a known prefix, return it as-is
		if (id.startsWith('mileage:') || id.startsWith('trip:') || id.startsWith('expense:')) {
			return id;
		}

		// Otherwise, prefix based on record type
		return `${recordType}:${id}`;
	};

	return {
		subscribe,

		async load(userId?: string, type?: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('trash', 'readonly');
				const store = tx.objectStore('trash');
				const items = userId ? await store.index('userId').getAll(userId) : await store.getAll();

				const normalizedItems = items.map((item) => {
					let flat = { ...item };
					if (flat.data && typeof flat.data === 'object') {
						flat = { ...flat.data, ...flat };
						delete flat.data;
					}
					return flat;
				});

				const filtered = type
					? normalizedItems.filter((it) => {
							if (it.recordType === type || it.type === type) return true;
							if (Array.isArray(it.recordTypes) && it.recordTypes.includes(type)) return true;
							if (type === 'expense' && it.originalKey?.startsWith('expense:')) return true;
							if (type === 'mileage' && it.originalKey?.startsWith('mileage:')) return true;
							if (type === 'trip' && it.originalKey?.startsWith('trip:')) return true;
							return false;
						})
					: normalizedItems;

				const projected = filtered.map((it) => {
					// If filtering for "mileage" but found a bundled "trip+mileage" item,
					// present it as a mileage log for the UI
					if (type && it.recordType !== type) {
						return { ...it, recordType: type, type: type };
					}
					return it;
				});

				projected.sort((a, b) => {
					const aTime = a && a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
					const bTime = b && b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
					return bTime - aTime;
				});

				set(projected);
				return projected;
			} catch (err) {
				console.error('❌ Failed to load trash:', err);
				set([]);
				return [];
			}
		},

		async restore(uniqueId: string, userId: string, targetType?: string, userName?: string) {
			try {
				const db = await getDB();

				// 1. Fetch Trash Item
				const txRead = db.transaction('trash', 'readonly');
				const stored = await txRead.objectStore('trash').get(uniqueId);
				await txRead.done;

				if (!stored) throw new Error('Item not found in trash');
				// MIGRATION FIX: Check ownership against both userId (UUID) and userName (legacy)
				if (!isRecordOwner(stored.userId, userId, userName)) throw new Error('Unauthorized');

				const recordTypes: string[] = Array.from(
					new Set(
						[
							...(Array.isArray(stored.recordTypes) ? stored.recordTypes : []),
							stored.recordType || stored.type
						].filter(Boolean) as string[]
					)
				);

				const restoreType =
					targetType || stored.recordType || stored.type || recordTypes[0] || 'trip';

				// 2. Logic Check: If restoring mileage, is parent trip safe?
				if (restoreType === 'mileage') {
					const realId = getRealId(uniqueId);
					const parentId = stored.tripId || realId;

					// Check trip existence if this mileage has a tripId (whether it's the same as realId or not)
					// This handles both auto logs (tripId !== realId) and trip-attached mileage (tripId === realId)
					if (stored.tripId) {
						const txCheck = db.transaction(['trips', 'trash'], 'readonly');
						const tripExists = await txCheck.objectStore('trips').get(parentId);
						const tripTrash =
							(await txCheck.objectStore('trash').get(`trip:${parentId}`)) ||
							(await txCheck.objectStore('trash').get(parentId));
						await txCheck.done;

						if (!tripExists) {
							if (tripTrash) {
								throw new Error(
									'The parent Trip is currently in the Trash. Please restore the Trip first.'
								);
							} else {
								throw new Error(
									'This mileage log belongs to a trip that has been permanently deleted. It cannot be restored.'
								);
							}
						}
					}
				}

				// 3. Prepare Data
				const backups: Record<string, any> =
					stored.backups || (stored.data && (stored.data.__backups as any)) || {};

				// Handle "backup" vs "backups" inconsistency from server vs local
				const backupFor = (t: string) =>
					backups[t] ||
					(stored.data && stored.data[t]) ||
					stored.backup ||
					(stored.recordType === t ? stored.data || stored : undefined) ||
					stored;

				const restored = { ...(backupFor(restoreType) || {}) };
				restored.id = getRealId(uniqueId);

				delete restored.deleted;
				delete restored.deletedAt;
				delete restored.metadata;
				delete restored.backup;
				delete restored.backups;
				delete restored.recordTypes;
				restored.updatedAt = new Date().toISOString();
				restored.syncStatus = 'pending';

				// 4. Atomic Write
				const mileageStoreName = getMileageStoreName(db);
				const tx = db.transaction(['trash', 'expenses', mileageStoreName, 'trips'], 'readwrite');
				if (restoreType === 'expense') {
					await tx.objectStore('expenses').put(restored);
				} else if (restoreType === 'mileage') {
					await tx.objectStore(mileageStoreName).put(restored);
				} else if (restoreType === 'trip') {
					// FIX: Write restored trip to IndexedDB so it persists
					await tx.objectStore('trips').put(restored);
				}

				// Always delete the trash item
				await tx.objectStore('trash').delete(uniqueId);
				await tx.done; // Finish transaction BEFORE updating Svelte stores

				// 5. Update Svelte Stores (Now safe to async import)
				if (restoreType === 'expense') {
					try {
						const { expenses } = await import('$lib/stores/expenses');
						expenses.updateLocal(restored);
					} catch {
						/* ignore */
					}
				} else if (restoreType === 'mileage') {
					try {
						const { mileage } = await import('$lib/stores/mileage');
						mileage.updateLocal(restored);
					} catch {
						/* ignore */
					}
					// Also update the associated trip's totalMiles and fuelCost
					try {
						const parentId = stored.tripId || getRealId(uniqueId);
						const tripTx = db.transaction('trips', 'readwrite');
						const tripStore = tripTx.objectStore('trips');
						const trip = await tripStore.get(parentId);
						if (trip && trip.userId === userId) {
							const { calculateFuelCost } = await import('$lib/utils/calculations');
							const newMiles = restored.miles || 0;
							const mpg = trip.mpg || 25;
							const gasPrice = trip.gasPrice || 3.5;
							const newFuelCost = calculateFuelCost(newMiles, mpg, gasPrice);
							const nowIso = new Date().toISOString();
							const patchedTrip = {
								...trip,
								totalMiles: newMiles,
								fuelCost: newFuelCost,
								updatedAt: nowIso,
								syncStatus: 'pending'
							};
							await tripStore.put(patchedTrip);
							await tripTx.done;
							// Update the trips store
							const { trips } = await import('$lib/stores/trips');
							trips.updateLocal({
								id: parentId,
								totalMiles: newMiles,
								fuelCost: newFuelCost,
								updatedAt: nowIso
							} as any);
							// Queue sync for trip update
							await syncManager.addToQueue({
								action: 'update',
								tripId: parentId,
								data: { ...patchedTrip, store: 'trips', skipEnrichment: true }
							});
						} else {
							await tripTx.done;
						}
					} catch {
						/* ignore trip update errors */
					}
				} else {
					try {
						const { trips } = await import('$lib/stores/trips');
						trips.updateLocal(restored);
						// Note: Bundled mileage is NOT auto-restored with trip.
					} catch {
						/* ignore */
					}
				}

				update((items) => items.filter((it) => it.id !== uniqueId));

				// 6. Queue Sync
				const syncTarget =
					restoreType === 'expense' ? 'expenses' : restoreType === 'mileage' ? 'mileage' : 'trips';
				await syncManager.addToQueue({
					action: 'restore',
					tripId: restored.id,
					data: { store: syncTarget, type: restoreType }
				});

				return restored;
			} catch (err) {
				console.error('❌ Failed to restore item:', err);
				throw err;
			}
		},

		async permanentDelete(id: string) {
			const db = await getDB();

			// First get the item to determine its record type
			const txRead = db.transaction('trash', 'readonly');
			const item = await txRead.objectStore('trash').get(id);
			await txRead.done;

			const tx = db.transaction('trash', 'readwrite');
			await tx.objectStore('trash').delete(id);
			await tx.done;
			update((l) => l.filter((t) => t.id !== id));

			const realId = getRealId(id);
			// Get record type from prefix or from the item's recordType property
			const recordType = getRecordType(id) || item?.recordType || item?.type;
			await syncManager.addToQueue({
				action: 'permanentDelete',
				tripId: realId,
				data: { recordType }
			});
		},

		async emptyTrash(userId: string) {
			const db = await getDB();
			const txRead = db.transaction('trash', 'readonly');
			const index = txRead.objectStore('trash').index('userId');
			const userItems = await index.getAll(userId);
			await txRead.done;

			const tx = db.transaction('trash', 'readwrite');
			for (const item of userItems) {
				await tx.objectStore('trash').delete(item.id);
			}
			await tx.done;

			update((current) => current.filter((item) => item.userId !== userId));

			for (const item of userItems) {
				const realId = getRealId(item.id);
				const recordType = getRecordType(item.id) || item.recordType || (item as any).type;
				await syncManager.addToQueue({
					action: 'permanentDelete',
					tripId: realId,
					data: { recordType }
				});
			}
			return userItems.length;
		},

		async syncFromCloud(userId: string, type?: string) {
			try {
				if (!navigator.onLine) return;

				const url = type ? `/api/trash?type=${encodeURIComponent(type)}` : '/api/trash';
				const response = await fetch(url);
				if (!response.ok) return;

				const cloudTrash: any = await response.json();
				const cloudIds = new Set<string>();

				const db = await getDB();
				const tx = db.transaction('trash', 'readwrite');
				const store = tx.objectStore('trash');

				for (const rawItem of cloudTrash) {
					let flatItem: any = { ...rawItem };

					if (flatItem.data) {
						flatItem = { ...flatItem.data, ...flatItem };
						delete flatItem.data;
					}
					if (flatItem.trip) flatItem = { ...flatItem.trip, ...flatItem };
					delete flatItem.trip;

					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt || flatItem.deletedAt;
						flatItem.expiresAt = flatItem.metadata.expiresAt || flatItem.expiresAt;
						flatItem.originalKey = flatItem.metadata.originalKey || flatItem.originalKey;

						if (!flatItem.userId && typeof flatItem.metadata.originalKey === 'string') {
							const parts = flatItem.metadata.originalKey.split(':');
							flatItem.userId = String(parts[1] || '');
						}
						delete flatItem.metadata;
					}

					if (!flatItem.id) continue;

					if (!flatItem.recordType && !flatItem.type) {
						if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
						else if (flatItem.originalKey?.startsWith('mileage:')) flatItem.recordType = 'mileage';
						else if (flatItem.originalKey?.startsWith('trip:')) flatItem.recordType = 'trip';
						else if (typeof flatItem.miles === 'number' && !flatItem.stops)
							flatItem.recordType = 'mileage';
						else flatItem.recordType = 'trip';
					} else if (flatItem.type && !flatItem.recordType) {
						flatItem.recordType = flatItem.type;
					}
					flatItem.type = flatItem.recordType;

					// [!code fix] Ensure Trash ID is unique on download
					const uniqueId = getUniqueTrashId(flatItem);
					flatItem.id = uniqueId;

					cloudIds.add(uniqueId);

					const local = await store.get(uniqueId);
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}

				const index = store.index('userId');
				const localItems = await index.getAll(userId);
				for (const localItem of localItems) {
					if (type && localItem.recordType !== type) continue;

					if (!cloudIds.has(localItem.id)) {
						if (localItem.syncStatus === 'pending') continue;
						await store.delete(localItem.id);
					}
				}
				await tx.done;

				// Cleanup Active Stores based on REAL IDs
				const mileageStoreName = getMileageStoreName(db);
				const cleanupTx = db.transaction(
					['trash', 'trips', 'expenses', mileageStoreName],
					'readwrite'
				);
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');
				const mileageStore = cleanupTx.objectStore(mileageStoreName);
				for (const trashItem of allTrash) {
					const realId = getRealId(trashItem.id);
					const rt = trashItem.recordType;

					if (rt === 'trip') {
						if (await tripStore.get(realId)) await tripStore.delete(realId);
					} else if (rt === 'expense') {
						if (await expenseStore.get(realId)) await expenseStore.delete(realId);
					} else if (rt === 'mileage') {
						if (await mileageStore.get(realId)) await mileageStore.delete(realId);
					}
				}
				await cleanupTx.done;

				await this.load(userId, type);
			} catch (err) {
				console.error('❌ Failed to sync trash:', err);
			}
		},

		async getCount(userId: string) {
			const items = await this.load(userId);
			return items.length;
		},

		clear() {
			set([]);
		}
	};
}

export const trash = createTrashStore();

syncManager.registerStore('trash', {
	updateLocal: () => {},
	syncDown: async () => {
		const user = get(authUser) as User | null;
		if (user?.id) await trash.syncFromCloud(user.id);
	}
});
