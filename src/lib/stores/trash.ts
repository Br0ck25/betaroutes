// src/lib/stores/trash.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';
import { user as authUser } from '$lib/stores/auth';
import type { User } from '$lib/types';

function createTrashStore() {
	const { subscribe, set, update } = writable<TrashRecord[]>([]);

	const getUniqueTrashId = (item: any) => {
		if (
			(item.recordType === 'millage' || item.type === 'millage') &&
			!String(item.id).startsWith('millage:')
		) {
			return `millage:${item.id}`;
		}
		return item.id;
	};

	const getRealId = (trashId: string) => {
		if (trashId.startsWith('millage:')) return trashId.replace('millage:', '');
		return trashId;
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
							if (type === 'millage' && it.originalKey?.startsWith('millage:')) return true;
							if (type === 'trip' && it.originalKey?.startsWith('trip:')) return true;
							return false;
						})
					: normalizedItems;

				const projected = filtered.map((it) => {
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

		async restore(uniqueId: string, userId: string, targetType?: string) {
			try {
				const db = await getDB();

				// 1. Read (Guard Checks)
				const txRead = db.transaction('trash', 'readonly');
				const stored = await txRead.objectStore('trash').get(uniqueId);
				await txRead.done;

				if (!stored) throw new Error('Item not found in trash');
				if (stored.userId !== userId) throw new Error('Unauthorized');

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

				if (restoreType === 'millage') {
					const realId = getRealId(uniqueId);
					const parentId = stored.tripId || realId;

					const txCheck = db.transaction(['trips', 'trash'], 'readonly');
					const tripExists = await txCheck.objectStore('trips').get(parentId);
					const tripTrash = await txCheck.objectStore('trash').get(parentId);
					await txCheck.done;

					if (!tripExists) {
						if (tripTrash) {
							throw new Error(
								'The parent Trip is currently in the Trash. Please switch to the "Trips" tab in Trash and restore the trip first.'
							);
						} else {
							throw new Error(
								'This mileage log belongs to a trip that has been permanently deleted. It cannot be restored.'
							);
						}
					}
				}

				// 2. Prepare Data
				const backups: Record<string, any> =
					stored.backups || (stored.data && (stored.data.__backups as any)) || {};

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

				// 3. Write Database (Atomic Transaction)
				const tx = db.transaction(['trash', 'expenses', 'millage', 'trips'], 'readwrite');

				if (restoreType === 'expense') {
					await tx.objectStore('expenses').put(restored);
				} else if (restoreType === 'millage') {
					await tx.objectStore('millage').put(restored);
				} else {
					await tx.objectStore('trips').put(restored);
				}

				// Delete from trash *inside* the transaction
				await tx.objectStore('trash').delete(uniqueId);

				// [!code fix] Wait for DB transaction to fully complete before calling async imports
				await tx.done;

				// 4. Update UI / Stores (Post-Transaction)
				// Now it is safe to use 'await import' without breaking the DB lock
				if (restoreType === 'expense') {
					try {
						const { expenses } = await import('$lib/stores/expenses');
						expenses.updateLocal(restored);
					} catch {
						/* ignore */
					}
				} else if (restoreType === 'millage') {
					try {
						const { millage } = await import('$lib/stores/millage');
						millage.updateLocal(restored);
					} catch {
						/* ignore */
					}
				} else {
					try {
						const { trips } = await import('$lib/stores/trips');
						trips.updateLocal(restored);
					} catch {
						/* ignore */
					}
				}

				update((items) => items.filter((it) => it.id !== uniqueId));

				// 5. Queue Sync
				const syncTarget =
					restoreType === 'expense' ? 'expenses' : restoreType === 'millage' ? 'millage' : 'trips';

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
			const tx = db.transaction('trash', 'readwrite');
			await tx.objectStore('trash').delete(id);
			await tx.done;
			update((l) => l.filter((t) => t.id !== id));

			const realId = getRealId(id);
			await syncManager.addToQueue({ action: 'permanentDelete', tripId: realId });
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
				await syncManager.addToQueue({ action: 'permanentDelete', tripId: realId });
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

					if (!flatItem.recordType && !flatItem.type) {
						if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
						else if (flatItem.originalKey?.startsWith('millage:')) flatItem.recordType = 'millage';
						else if (flatItem.originalKey?.startsWith('trip:')) flatItem.recordType = 'trip';
						else if (typeof flatItem.miles === 'number' && !flatItem.stops)
							flatItem.recordType = 'millage';
						else flatItem.recordType = 'trip';
					} else if (flatItem.type && !flatItem.recordType) {
						flatItem.recordType = flatItem.type;
					}
					flatItem.type = flatItem.recordType;

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
						savedCount++;
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

				// Cleanup Active Stores
				const cleanupTx = db.transaction(['trash', 'trips', 'expenses', 'millage'], 'readwrite');
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');
				const millageStore = cleanupTx.objectStore('millage');

				for (const trashItem of allTrash) {
					const realId = getRealId(trashItem.id);
					const rt = trashItem.recordType;

					if (rt === 'trip') {
						if (await tripStore.get(realId)) await tripStore.delete(realId);
					} else if (rt === 'expense') {
						if (await expenseStore.get(realId)) await expenseStore.delete(realId);
					} else if (rt === 'millage') {
						if (await millageStore.get(realId)) await millageStore.delete(realId);
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
