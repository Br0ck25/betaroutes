// src/lib/stores/trash.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';
import { user as authUser } from '$lib/stores/auth';
import type { User } from '$lib/types';

function createTrashStore() {
	const { subscribe, set, update } = writable<TrashRecord[]>([]);

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

				// [!code fix] improved type detection to prevent millage appearing as trips
				const getType = (it: any) => {
					if (it.recordType) return it.recordType;
					if (it.type) return it.type;
					if (it.originalKey) {
						if (it.originalKey.startsWith('expense:')) return 'expense';
						if (it.originalKey.startsWith('millage:')) return 'millage';
						if (it.originalKey.startsWith('trip:')) return 'trip';
					}
					// Fallback heuristics
					if (typeof it.miles === 'number' && !it.stops) return 'millage';
					return 'trip'; // Default
				};

				const filtered = type
					? normalizedItems.filter((it) => getType(it) === type)
					: normalizedItems;

				filtered.sort((a, b) => {
					const aTime = a && a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
					const bTime = b && b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
					return bTime - aTime;
				});
				set(filtered);
				return filtered;
			} catch (err) {
				console.error('❌ Failed to load trash:', err);
				set([]);
				return [];
			}
		},

		async restore(id: string, userId: string, targetType?: string) {
			try {
				const db = await getDB();

				// [!code fix] Step 1: Read/Check Phase (Separate Transaction)
				// We must do this separate from the write transaction to avoid "Transaction finished" errors
				// during the async/await gap.
				const txRead = db.transaction('trash', 'readonly');
				const stored = await txRead.objectStore('trash').get(id);
				await txRead.done;

				if (!stored) throw new Error('Item not found in trash');
				if (stored.userId !== userId) throw new Error('Unauthorized');

				// Normalize available backups and recordTypes
				const backups: Record<string, any> =
					stored.backups || (stored.data && (stored.data.__backups as any)) || {};
				const recordTypes: string[] = Array.from(
					new Set(
						[
							...(Array.isArray(stored.recordTypes) ? stored.recordTypes : []),
							stored.recordType ||
								stored.type ||
								(stored.originalKey ? String(stored.originalKey).split(':')[0] : undefined)
						].filter(Boolean) as string[]
					)
				);

				const desired =
					targetType ||
					stored.type ||
					stored.recordType ||
					(recordTypes.length ? recordTypes[0] : undefined);
				if (!desired && recordTypes.length > 1)
					throw new Error('Ambiguous tombstone: specify which record type to restore');
				const restoreType = desired || recordTypes[0] || 'trip';

				// [!code fix] Invariant Check: Parent Trip Existence
				if (restoreType === 'millage') {
					// Need to find the trip ID. It might be on the root or inside 'data' or 'backups'
					const backupData =
						backups['millage'] || stored.data || (stored.recordType === 'millage' ? stored : {});
					const parentTripId = stored.tripId || backupData.tripId;

					if (parentTripId) {
						// Check if parent trip is active
						const txCheck = db.transaction(['trips', 'trash'], 'readonly');
						const tripExists = await txCheck.objectStore('trips').get(parentTripId);
						const tripTrash = await txCheck.objectStore('trash').get(parentTripId);
						await txCheck.done;

						// If trip is NOT active (missing from 'trips' store), block restore.
						// Even if it's not in trash (permanently deleted), we can't restore a child to a ghost parent.
						if (!tripExists) {
							if (tripTrash) {
								throw new Error(
									'This mileage log belongs to a trip that is currently in the trash. Restore the trip first.'
								);
							} else {
								throw new Error(
									'This mileage log belongs to a trip that has been permanently deleted. It cannot be restored.'
								);
							}
						}
					}
				}

				// [!code fix] Step 2: Write Phase (Single Atomic Transaction)
				const tx = db.transaction(['trash', 'expenses', 'millage', 'trips'], 'readwrite');

				// Prepare object
				const backupFor = (t: string) =>
					backups[t] ||
					(stored.data && stored.data[t]) ||
					(stored.recordType === t ? stored.data || stored : undefined) ||
					stored;
				const restored = { ...(backupFor(restoreType) || {}) };

				delete restored.deleted;
				delete restored.deletedAt;
				delete restored.metadata;
				delete restored.backup;
				delete restored.backups; // Ensure we don't restore the trash container fields
				delete restored.recordTypes;
				restored.updatedAt = new Date().toISOString();
				restored.syncStatus = 'pending';

				// Write to Active Store
				if (restoreType === 'expense') {
					await tx.objectStore('expenses').put(restored);
				} else if (restoreType === 'millage') {
					await tx.objectStore('millage').put(restored);
				} else {
					await tx.objectStore('trips').put(restored);
				}

				// Update Trash Store (Remove or Degrade)
				const remaining = recordTypes.filter((r) => r !== restoreType);
				if (remaining.length === 0) {
					await tx.objectStore('trash').delete(id);
					update((items) => items.filter((it) => it.id !== id));
				} else {
					if (stored.backups && stored.backups[restoreType]) delete stored.backups[restoreType];
					stored.recordTypes = remaining;
					// Refresh primary view fields
					const primary = remaining[0] as string | undefined;
					const pb = primary ? backupFor(primary) : {};
					stored.miles = (pb as any).miles ?? stored.miles;
					stored.vehicle = pb.vehicle ?? stored.vehicle;
					stored.date = pb.date ?? stored.date;
					stored.syncStatus = 'pending';
					await tx.objectStore('trash').put(stored);
					update((items) => items.map((it) => (it.id === id ? stored : it)));
				}

				await tx.done;

				// Sync Queue (Background)
				const syncTarget =
					restoreType === 'expense' ? 'expenses' : restoreType === 'millage' ? 'millage' : 'trips';
				await syncManager.addToQueue({
					action: 'restore',
					tripId: id,
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
			const tx = db.transaction('trash', 'readwrite');
			await tx.objectStore('trash').delete(id);
			await tx.done;
			update((l) => l.filter((t) => t.id !== id));
			await syncManager.addToQueue({ action: 'permanentDelete', tripId: id });
		},

		async emptyTrash(userId: string) {
			const db = await getDB();
			const txRead = db.transaction('trash', 'readonly');
			const index = txRead.objectStore('trash').index('userId');
			const userItems = await index.getAll(userId);
			await txRead.done;

			if (userItems.length === 0) return 0;

			const tx = db.transaction('trash', 'readwrite');
			for (const item of userItems) {
				await tx.objectStore('trash').delete(item.id);
			}
			await tx.done;

			update((current) => current.filter((item) => item.userId !== userId));

			for (const item of userItems) {
				await syncManager.addToQueue({ action: 'permanentDelete', tripId: item.id });
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

				let savedCount = 0;
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

					// [!code fix] Enhanced type inference so millage isn't confused for trip
					if (!flatItem.recordType && !flatItem.type) {
						if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
						else if (flatItem.originalKey?.startsWith('millage:')) flatItem.recordType = 'millage';
						else if (flatItem.originalKey?.startsWith('trip:')) flatItem.recordType = 'trip';
						else if (typeof flatItem.miles === 'number' && !flatItem.stops)
							// Heuristic: has miles but no stops likely millage log
							flatItem.recordType = 'millage';
						else flatItem.recordType = 'trip';
					} else if (flatItem.type && !flatItem.recordType) {
						flatItem.recordType = flatItem.type;
					}

					flatItem.type = flatItem.recordType;
					// ... (rest of merging logic unchanged) ...
					if (Array.isArray(flatItem.containsRecordTypes)) {
						flatItem.recordTypes = Array.from(
							new Set([flatItem.recordType, ...flatItem.containsRecordTypes])
						);
					} else if (flatItem.recordTypes && Array.isArray(flatItem.recordTypes)) {
						flatItem.recordTypes = Array.from(
							new Set(flatItem.recordTypes.concat(flatItem.recordType))
						);
					} else {
						flatItem.recordTypes = [flatItem.recordType];
					}

					cloudIds.add(flatItem.id);

					const local = await store.get(flatItem.id);
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
						savedCount++;
					}
				}
				if (savedCount > 0)
					console.debug(`[trash] Synced ${savedCount} items from cloud (type=${type})`);

				const index = store.index('userId');
				const localItems = await index.getAll(userId);
				for (const localItem of localItems) {
					if (!cloudIds.has(localItem.id)) {
						if (localItem.syncStatus === 'pending') continue;
						await store.delete(localItem.id);
					}
				}
				await tx.done;

				// Cleanup Active Stores
				const cleanupTx = db.transaction(['trash', 'trips', 'expenses', 'millage'], 'readwrite');
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');
				const millageStore = cleanupTx.objectStore('millage');

				for (const trashItem of allTrash) {
					const rt =
						(trashItem.recordType as string) ||
						(trashItem.originalKey && String(trashItem.originalKey).startsWith('expense:')
							? 'expense'
							: 'trip');

					if (rt === 'trip') {
						if (await tripStore.get(trashItem.id)) await tripStore.delete(trashItem.id);
					} else if (rt === 'expense') {
						if (await expenseStore.get(trashItem.id)) await expenseStore.delete(trashItem.id);
					} else if (rt === 'millage') {
						if (await millageStore.get(trashItem.id)) await millageStore.delete(trashItem.id);
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
