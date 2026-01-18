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

				// Normalize/Flatten similar to +page.svelte logic for consistency in store
				const normalizedItems = items.map((item) => {
					let flat = { ...item };
					if (flat.data && typeof flat.data === 'object') {
						flat = { ...flat.data, ...flat };
						delete flat.data;
					}
					return flat;
				});

				// Filter by type if provided (expense or trip)
				const filtered = type
					? normalizedItems.filter(
							(it) =>
								(it.recordType ||
								it.type ||
								(it.originalKey && it.originalKey.startsWith('expense:'))
									? it.recordType || it.type || 'expense'
									: 'trip') === type
						)
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
				const tx = db.transaction('trash', 'readwrite');
				const stored = await tx.objectStore('trash').get(id);

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

				// Pick which type to restore: caller hint > tombstone primary > first available
				const desired =
					targetType ||
					stored.type ||
					stored.recordType ||
					(recordTypes.length ? recordTypes[0] : undefined);
				if (!desired && recordTypes.length > 1)
					throw new Error('Ambiguous tombstone: specify which record type to restore');
				const restoreType = desired || recordTypes[0] || 'trip';

				// Enforce invariant: cannot restore millage if parent trip is deleted
				if (restoreType === 'millage') {
					const tripExists = await db.transaction('trips', 'readonly').objectStore('trips').get(id);
					const tripTrash = await db.transaction('trash', 'readonly').objectStore('trash').get(id);
					if (
						!tripExists &&
						tripTrash &&
						(tripTrash.recordType === 'trip' ||
							String(tripTrash.originalKey || '').startsWith('trip:'))
					) {
						throw new Error(
							'This mileage log belongs to a trip that has been deleted. Restore the trip first to restore this mileage.'
						);
					}
				}

				// Obtain the correct backup shape for the requested type
				const backupFor = (t: string) =>
					backups[t] ||
					(stored.data && stored.data[t]) ||
					(stored.recordType === t ? stored.data || stored : undefined) ||
					stored;
				const restored = { ...(backupFor(restoreType) || {}) };
				// Clean metadata
				delete restored.deleted;
				delete restored.deletedAt;
				delete restored.metadata;
				delete restored.backup;
				restored.updatedAt = new Date().toISOString();
				restored.syncStatus = 'pending';

				// Write restored record to the appropriate store
				if (restoreType === 'expense') {
					await db.transaction('expenses', 'readwrite').objectStore('expenses').put(restored);
				} else if (restoreType === 'millage') {
					await db.transaction('millage', 'readwrite').objectStore('millage').put(restored);
				} else {
					await db.transaction('trips', 'readwrite').objectStore('trips').put(restored);
				}

				// If tombstone contained multiple types, remove only the restored type backup and keep the rest
				const remaining = recordTypes.filter((r) => r !== restoreType);
				if (remaining.length === 0) {
					await tx.objectStore('trash').delete(id);
					update((items) => items.filter((it) => it.id !== id));
				} else {
					if (stored.backups && stored.backups[restoreType]) delete stored.backups[restoreType];
					stored.recordTypes = remaining;
					// refresh convenience fields from the first remaining backup
					const primary = remaining[0] as string | undefined;
					const pb = primary ? backupFor(primary) : {};
					stored.miles = (pb as any).miles ?? stored.miles;
					stored.vehicle = pb.vehicle ?? stored.vehicle;
					stored.date = pb.date ?? stored.date;
					stored.syncStatus = 'pending';
					await tx.objectStore('trash').put(stored);
					update((items) => items.map((it) => (it.id === id ? stored : it)));
				}

				// Enqueue a sync that specifies which store/type was restored
				const syncTarget =
					restoreType === 'expense' ? 'expenses' : restoreType === 'millage' ? 'millage' : 'trips';
				await (async () =>
					syncManager.addToQueue({
						action: 'restore',
						tripId: id,
						data: { store: syncTarget, type: restoreType }
					}))();

				await tx.done;
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

			// Update store to remove deleted items
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
					// Normalize Item
					let flatItem: any = { ...rawItem };

					// Handle generic 'data' wrapper if present from new API
					if (flatItem.data) {
						flatItem = { ...flatItem.data, ...flatItem };
						delete flatItem.data;
					}
					// Handle legacy 'trip' wrapper
					if (flatItem.trip) flatItem = { ...flatItem.trip, ...flatItem };
					delete flatItem.trip;

					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt || flatItem.deletedAt;
						flatItem.expiresAt = flatItem.metadata.expiresAt || flatItem.expiresAt;
						flatItem.originalKey = flatItem.metadata.originalKey || flatItem.originalKey;

						// If metadata includes originalKey but no userId, derive it (guarded)
						if (!flatItem.userId && typeof flatItem.metadata.originalKey === 'string') {
							const parts = flatItem.metadata.originalKey.split(':');
							flatItem.userId = String(parts[1] || '');
						}

						delete flatItem.metadata;
					}

					if (!flatItem.id) continue;

					// Determine Record Type (enhanced): respect explicit fields, originalKey, or
					// infer from millage-specific properties when tombstones were merged.
					if (!flatItem.recordType && !flatItem.type) {
						if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
						else if (flatItem.originalKey?.startsWith('millage:')) flatItem.recordType = 'millage';
						// Heuristic: merged trip-trash can carry millage fields (miles/vehicle)
						else if (typeof flatItem.miles === 'number' || flatItem.vehicle)
							flatItem.recordType = 'millage';
						else flatItem.recordType = 'trip';
					} else if (flatItem.type && !flatItem.recordType) {
						flatItem.recordType = flatItem.type;
					}

					// Keep a convenience 'type' aligned with recordType and expose any merged types
					flatItem.type = flatItem.recordType;
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

				// Reconciliation: Remove local items not in cloud (unless pending)
				const index = store.index('userId');
				const localItems = await index.getAll(userId);
				for (const localItem of localItems) {
					if (!cloudIds.has(localItem.id)) {
						if (localItem.syncStatus === 'pending') continue;
						await store.delete(localItem.id);
					}
				}
				await tx.done;

				// Cleanup Active Stores (Safety Check to prevent duplicates in active lists)
				const cleanupTx = db.transaction(['trash', 'trips', 'expenses', 'millage'], 'readwrite');
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');
				const millageStore = cleanupTx.objectStore('millage');

				for (const trashItem of allTrash) {
					// Only remove from the active store that matches the tombstone's recordType
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
					} else {
						// Fallback (legacy): remove any matching active records if type ambiguous
						if (await tripStore.get(trashItem.id)) await tripStore.delete(trashItem.id);
						if (await expenseStore.get(trashItem.id)) await expenseStore.delete(trashItem.id);
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

// [!code fix] Register with SyncManager so it syncs in background!
syncManager.registerStore('trash', {
	updateLocal: () => {}, // Trash handles its own updates via syncFromCloud logic usually
	syncDown: async () => {
		const user = get(authUser) as User | null;
		if (user?.id) await trash.syncFromCloud(user.id);
	}
});
