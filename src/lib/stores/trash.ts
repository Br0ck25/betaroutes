// src/lib/stores/trash.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';

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

				filtered.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
				set(filtered);
				return filtered;
			} catch (err) {
				console.error('❌ Failed to load trash:', err);
				set([]);
				return [];
			}
		},

		async restore(id: string, userId: string) {
			try {
				const db = await getDB();
				const trashTx = db.transaction('trash', 'readonly');
				const trashItem = await trashTx.objectStore('trash').get(id);

				if (!trashItem) throw new Error('Item not found in trash');
				if (trashItem.userId !== userId) throw new Error('Unauthorized');

				// Deep clone and handle potential nested structure
				let restoredItem = { ...trashItem };

				// If stored as nested { data: ... }, flatten it first to get the actual fields
				if (restoredItem.data && typeof restoredItem.data === 'object') {
					restoredItem = { ...restoredItem.data, ...restoredItem };
					delete restoredItem.data;
				}

				// Remove trash-specific metadata
				delete (restoredItem as any).deletedAt;
				delete (restoredItem as any).deletedBy;
				delete (restoredItem as any).expiresAt;

				const originalKey = restoredItem.originalKey;
				const type = restoredItem.type || restoredItem.recordType;

				delete (restoredItem as any).originalKey;
				delete (restoredItem as any).recordType;
				delete (restoredItem as any).type; // Clean up convenience type if present

				restoredItem.updatedAt = new Date().toISOString();
				restoredItem.syncStatus = 'pending';

				// Detect type and restore to correct store
				// Check 'type', 'recordType', or 'originalKey' prefix
				if (type === 'expense' || (originalKey && originalKey.startsWith('expense:'))) {
					console.log('Restoring expense:', id);
					const tx = db.transaction('expenses', 'readwrite');
					await tx.objectStore('expenses').put(restoredItem);
					await tx.done;
				} else {
					console.log('Restoring trip:', id);
					const tx = db.transaction('trips', 'readwrite');
					await tx.objectStore('trips').put(restoredItem);
					await tx.done;
				}

				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				update((items) => items.filter((item) => item.id !== id));

				// Determine target store for sync action
				const syncTarget =
					type === 'expense' || (originalKey && originalKey.startsWith('expense:'))
						? 'expenses'
						: 'trips';

				await syncManager.addToQueue({
					action: 'restore',
					tripId: id,
					data: { store: syncTarget } // Hint to worker where to restore
				});

				return restoredItem;
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
						delete flatItem.metadata;
					}

					if (!flatItem.id) continue;

					// Determine Record Type
					if (!flatItem.recordType && !flatItem.type) {
						if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
						else flatItem.recordType = 'trip';
					} else if (flatItem.type && !flatItem.recordType) {
						flatItem.recordType = flatItem.type;
					}

					cloudIds.add(flatItem.id);

					const local = await store.get(flatItem.id);
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}

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
				const cleanupTx = db.transaction(['trash', 'trips', 'expenses'], 'readwrite');
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');

				for (const trashItem of allTrash) {
					if (await tripStore.get(trashItem.id)) {
						await tripStore.delete(trashItem.id);
					}
					if (await expenseStore.get(trashItem.id)) {
						await expenseStore.delete(trashItem.id);
					}
				}
				await cleanupTx.done;

				await this.load(userId, type === 'expenses' ? 'expense' : type);
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
