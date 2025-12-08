// src/lib/stores/trash.ts
import { writable } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { TrashRecord } from '$lib/db/types';

/**
 * Offline-first trash store
 * * All operations save to IndexedDB FIRST, then queue for cloud sync
 * Works 100% offline - syncs automatically when online
 */
function createTrashStore() {
	const { subscribe, set, update } = writable<TrashRecord[]>([]);

	return {
		subscribe,

		/**
		 * Load all trash items from IndexedDB
		 * Call this on app startup or when viewing trash page
		 */
		async load(userId?: string) {
			try {
				console.log('🗑️ Loading trash from IndexedDB...');
				const db = await getDB();
				const tx = db.transaction('trash', 'readonly');
				const store = tx.objectStore('trash');

				let items: TrashRecord[];

				if (userId) {
					// Load trash for specific user
					const index = store.index('userId');
					items = await index.getAll(userId);
				} else {
					// Load all trash (for dev/testing)
					items = await store.getAll();
				}

				// Sort by deletion date (newest first)
				items.sort((a, b) => {
					const dateA = new Date(a.deletedAt).getTime();
					const dateB = new Date(b.deletedAt).getTime();
					return dateB - dateA;
				});

				set(items);
				console.log(`✅ Loaded ${items.length} trash item(s) from IndexedDB`);

				return items;
			} catch (err) {
				console.error('❌ Failed to load trash:', err);
				set([]);
				return [];
			}
		},

		/**
		 * Restore a trip from trash (offline-first)
		 */
		async restore(id: string, userId: string) {
			try {
				console.log('♻️ Restoring trip from trash:', id);

				const db = await getDB();

				// 1. Get item from trash
				const trashTx = db.transaction('trash', 'readonly');
				const trashItem = await trashTx.objectStore('trash').get(id);

				if (!trashItem) {
					throw new Error('Item not found in trash');
				}

				// Verify ownership
				if (trashItem.userId !== userId) {
					throw new Error('Unauthorized');
				}

				// 2. Create restored trip (remove trash metadata)
				const restoredTrip = {
					...trashItem,
					updatedAt: new Date().toISOString(),
					syncStatus: 'pending' as const,
					// Remove trash-specific fields
					deletedAt: undefined,
					deletedBy: undefined,
					expiresAt: undefined,
					originalKey: undefined
				};

				// Clean up undefined fields
				Object.keys(restoredTrip).forEach((key) => {
					if (restoredTrip[key as keyof typeof restoredTrip] === undefined) {
						delete restoredTrip[key as keyof typeof restoredTrip];
					}
				});

				// 3. Move back to active trips in IndexedDB
				const tripsTx = db.transaction('trips', 'readwrite');
				await tripsTx.objectStore('trips').put(restoredTrip);
				await tripsTx.done;

				// 4. Remove from trash in IndexedDB
				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				// 5. Update UI immediately
				update((items) => items.filter((item) => item.id !== id));

				// 6. Queue for cloud sync
				await syncManager.addToQueue({
					action: 'restore',
					tripId: id
				});

				console.log('✅ Trip restored from trash:', id);

				return restoredTrip;
			} catch (err) {
				console.error('❌ Failed to restore trip:', err);
				throw err;
			}
		},

		/**
		 * Permanently delete a trip from trash (offline-first)
		 * Cannot be undone!
		 */
		async permanentDelete(id: string, userId: string) {
			try {
				console.log('💥 Permanently deleting from trash:', id);

				const db = await getDB();

				// 1. Get item to verify ownership
				const trashTx = db.transaction('trash', 'readonly');
				const trashItem = await trashTx.objectStore('trash').get(id);

				if (!trashItem) {
					throw new Error('Item not found in trash');
				}

				// Verify ownership
				if (trashItem.userId !== userId) {
					throw new Error('Unauthorized');
				}

				// 2. Delete from trash in IndexedDB
				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				// 3. Update UI immediately
				update((items) => items.filter((item) => item.id !== id));

				// 4. Queue for cloud sync
				await syncManager.addToQueue({
					action: 'permanentDelete',
					tripId: id
				});

				console.log('✅ Trip permanently deleted:', id);
			} catch (err) {
				console.error('❌ Failed to permanently delete trip:', err);
				throw err;
			}
		},

		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) {
					console.log('📴 Cannot sync trash from cloud while offline');
					return;
				}

				console.log('🔄 Syncing trash from cloud...');

				const response = await fetch('/api/trash');
				if (!response.ok) {
					throw new Error('Failed to fetch trash from cloud');
				}

				const cloudTrash: TrashRecord[] = await response.json();
				
				// 1. Reconciliation Set: Create a Set of all trash IDs from the cloud
				const cloudTrashIds = new Set(cloudTrash.map(t => t.id)); //

				// 2. Open DB transaction
				const db = await getDB(); //
				const tx = db.transaction('trash', 'readwrite'); //
				const store = tx.objectStore('trash'); //
				const index = store.index('userId');

				// 3. Merge new/updated items (PULL new cloud items to local DB)
				for (const cloudItem of cloudTrash) {
					// Normalize: Flatten metadata if present
					const flatItem: any = { ...cloudItem };
					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt;
						flatItem.deletedBy = flatItem.metadata.deletedBy;
						flatItem.expiresAt = flatItem.metadata.expiresAt;
						flatItem.originalKey = flatItem.metadata.originalKey;
						delete flatItem.metadata;
					}

					const local = await store.get(flatItem.id);

					// Only update if cloud is newer or doesn't exist locally
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}
				
				// 4. Reconciliation: Handle remote deletions/restorations (REMOVE stale local items)
				const localTrashItems = await index.getAll(userId); // Get all local items for this user

				for (const localItem of localTrashItems) {
					// If the item is in local trash but NOT in the cloud trash, it was removed remotely.
					if (!cloudTrashIds.has(localItem.id)) {
						console.log(`🗑️ Reconciliation: Removing remotely deleted/restored item from local trash: ${localItem.id}`);
						await store.delete(localItem.id);
					}
				}


				await tx.done; //

				// Reload from IndexedDB
				await this.load(userId); //

				console.log('✅ Synced trash from cloud');
			} catch (err) {
				console.error('❌ Failed to sync trash from cloud:', err); //
			}
		}

		/**
		 * Empty all trash items (offline-first)
		 */
		async emptyTrash(userId: string) {
			try {
				console.log('🗑️ Emptying trash for user:', userId);

				const db = await getDB();

				// 1. Get all items for this user
				const getTx = db.transaction('trash', 'readonly');
				const index = getTx.objectStore('trash').index('userId');
				const userItems = await index.getAll(userId);

				if (userItems.length === 0) {
					console.log('✅ Trash already empty');
					return 0;
				}

				// 2. Delete all items in IndexedDB
				const deleteTx = db.transaction('trash', 'readwrite');
				const store = deleteTx.objectStore('trash');

				for (const item of userItems) {
					await store.delete(item.id);
				}

				await deleteTx.done;

				// 3. Update UI immediately
				set([]);

				// 4. Queue each for cloud sync
				for (const item of userItems) {
					await syncManager.addToQueue({
						action: 'permanentDelete',
						tripId: item.id
					});
				}

				console.log(`✅ Emptied ${userItems.length} item(s) from trash`);

				return userItems.length;
			} catch (err) {
				console.error('❌ Failed to empty trash:', err);
				throw err;
			}
		},

		/**
		 * Get count of items in trash
		 */
		async getCount(userId: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('trash', 'readonly');
				const index = tx.objectStore('trash').index('userId');
				const items = await index.getAll(userId);
				return items.length;
			} catch (err) {
				console.error('❌ Failed to get trash count:', err);
				return 0;
			}
		},

		/**
		 * Clear all trash from store (for logout)
		 */
		clear() {
			set([]);
		},

		/**
		 * Sync from cloud (pull remote trash items)
		 */
		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) {
					console.log('📴 Cannot sync trash from cloud while offline');
					return;
				}

				console.log('🔄 Syncing trash from cloud...');

				const response = await fetch('/api/trash');
				if (!response.ok) {
					throw new Error('Failed to fetch trash from cloud');
				}

				const cloudTrash = await response.json();

				// Merge with local trash
				const db = await getDB();
				const tx = db.transaction('trash', 'readwrite');
				const store = tx.objectStore('trash');

				for (const cloudItem of cloudTrash) {
					// Normalize: Flatten metadata if present
					const flatItem = { ...cloudItem };
					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt;
						flatItem.deletedBy = flatItem.metadata.deletedBy;
						flatItem.expiresAt = flatItem.metadata.expiresAt;
						flatItem.originalKey = flatItem.metadata.originalKey;
						delete flatItem.metadata;
					}

					const local = await store.get(flatItem.id);

					// Only update if cloud is newer or doesn't exist locally
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}

				await tx.done;

				// Reload from IndexedDB
				await this.load(userId);

				console.log('✅ Synced trash from cloud');
			} catch (err) {
				console.error('❌ Failed to sync trash from cloud:', err);
			}
		}
	};
}

export const trash = createTrashStore();
