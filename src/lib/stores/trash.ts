// src/lib/stores/trash.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';

function createTrashStore() {
	const { subscribe, set, update } = writable<TrashRecord[]>([]);

	return {
		subscribe,

		async load(userId?: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('trash', 'readonly');
				const store = tx.objectStore('trash');
				
				let items = [];
				if (userId) {
					// This query ONLY works if userId is at the top level of the object
					items = await store.index('userId').getAll(userId);
				} else {
					items = await store.getAll();
				}

				// Safety flatten on load, just in case old data exists
				const flatItems = items.map(normalizeTrashItem);
				
				flatItems.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
				set(flatItems);
				return flatItems;
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

				// Deep clone and normalize
				let restoredItem = normalizeTrashItem(trashItem);

				// Remove trash-specific metadata
				delete (restoredItem as any).deletedAt;
				delete (restoredItem as any).deletedBy;
				delete (restoredItem as any).expiresAt;
				
				const originalKey = restoredItem.originalKey;
				const type = restoredItem.type || restoredItem.recordType;

				delete (restoredItem as any).originalKey;
				delete (restoredItem as any).recordType;
				delete (restoredItem as any).type; 

				restoredItem.updatedAt = new Date().toISOString();
				restoredItem.syncStatus = 'pending';

				// Detect type and restore to correct store
				if (type === 'expense' || (originalKey && originalKey.startsWith('expense:'))) {
					const tx = db.transaction('expenses', 'readwrite');
					await tx.objectStore('expenses').put(restoredItem);
					await tx.done;
				} else {
					const tx = db.transaction('trips', 'readwrite');
					await tx.objectStore('trips').put(restoredItem);
					await tx.done;
				}

				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				update((items) => items.filter((item) => item.id !== id));
				
				const syncTarget = (type === 'expense' || (originalKey && originalKey.startsWith('expense:'))) ? 'expenses' : 'trips';
				
				await syncManager.addToQueue({ 
					action: 'restore', 
					tripId: id,
					data: { store: syncTarget } 
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
			
			update(current => current.filter(item => item.userId !== userId));

			for (const item of userItems) {
				await syncManager.addToQueue({ action: 'permanentDelete', tripId: item.id });
			}
			return userItems.length;
		},

		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) return;

				const response = await fetch('/api/trash');
				if (!response.ok) return;

				const cloudTrash: any = await response.json();
				const cloudIds = new Set<string>();

				const db = await getDB();
				const tx = db.transaction('trash', 'readwrite');
				const store = tx.objectStore('trash');

				for (const rawItem of cloudTrash) {
					// [!code fix] CRITICAL: Normalize BEFORE saving to IndexedDB
					// This ensures 'userId' is at the root so the index.getAll(userId) query works
					const flatItem = normalizeTrashItem(rawItem);

					if (!flatItem.id) continue;

					// Ensure userId is present for indexing
					if (!flatItem.userId && userId) flatItem.userId = userId;

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

				// Reconciliation
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
				const cleanupTx = db.transaction(['trash', 'trips', 'expenses'], 'readwrite');
				const allTrash = await cleanupTx.objectStore('trash').getAll();
				const tripStore = cleanupTx.objectStore('trips');
				const expenseStore = cleanupTx.objectStore('expenses');

				for (const trashItem of allTrash) {
					if (await tripStore.get(trashItem.id)) await tripStore.delete(trashItem.id);
					if (await expenseStore.get(trashItem.id)) await expenseStore.delete(trashItem.id);
				}
				await cleanupTx.done;

				await this.load(userId);
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

// Helper to flatten nested data structures from server
function normalizeTrashItem(item: any): any {
	let flat = { ...item };

	// 1. Flatten 'data' wrapper (used by Expense deletion)
	if (flat.data && typeof flat.data === 'object') {
		// We prioritize keys in 'data' (like userId, amount) over the wrapper
		flat = { ...flat.data, ...flat };
		// Explicitly copy ID/UserID from data if wrapper is missing them
		if (item.data.id) flat.id = item.data.id;
		if (item.data.userId) flat.userId = item.data.userId;
		delete flat.data;
	}

	// 2. Flatten legacy 'trip' wrapper
	if (flat.trip) {
		flat = { ...flat.trip, ...flat };
		if (item.trip.id) flat.id = item.trip.id;
		if (item.trip.userId) flat.userId = item.trip.userId;
		delete flat.trip;
	}

	// 3. Flatten metadata
	if (flat.metadata) {
		flat.deletedAt = flat.metadata.deletedAt || flat.deletedAt;
		flat.expiresAt = flat.metadata.expiresAt || flat.expiresAt;
		flat.originalKey = flat.metadata.originalKey || flat.originalKey;
		delete flat.metadata;
	}

	// 4. Ensure record type
	if (!flat.recordType && !flat.type) {
		if (flat.originalKey?.startsWith('expense:')) flat.recordType = 'expense';
		else flat.recordType = 'trip';
	} else if (flat.type && !flat.recordType) {
		flat.recordType = flat.type;
	}

	return flat;
}

export const trash = createTrashStore();