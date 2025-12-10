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
		 */
		async load(userId?: string) {
			try {
				console.log('🗑️ Loading trash from IndexedDB...');
				const db = await getDB();
				const tx = db.transaction('trash', 'readonly');
				const store = tx.objectStore('trash');

				let items: TrashRecord[];

				if (userId) {
					const index = store.index('userId');
					items = await index.getAll(userId);
				} else {
					items = await store.getAll();
				}

				// Sort by deletion date (newest first)
				items.sort((a, b) => {
					const dateA = new Date(a.deletedAt).getTime();
					const dateB = new Date(b.deletedAt).getTime();
					return dateB - dateA;
				});

				set(items);
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

				if (!trashItem) throw new Error('Item not found in trash');
				if (trashItem.userId !== userId) throw new Error('Unauthorized');

				// 2. Create restored trip (clean up metadata)
				const restoredTrip = { ...trashItem };
				
				// Remove trash-specific fields
				delete (restoredTrip as any).deletedAt;
				delete (restoredTrip as any).deletedBy;
				delete (restoredTrip as any).expiresAt;
				delete (restoredTrip as any).originalKey;

				restoredTrip.updatedAt = new Date().toISOString();
				restoredTrip.syncStatus = 'pending';

				// 3. Move back to active trips
				const tripsTx = db.transaction('trips', 'readwrite');
				await tripsTx.objectStore('trips').put(restoredTrip);
				await tripsTx.done;

				// 4. Remove from trash
				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				// 5. Update UI & Queue Sync
				update((items) => items.filter((item) => item.id !== id));
				await syncManager.addToQueue({ action: 'restore', tripId: id });

				return restoredTrip;
			} catch (err) {
				console.error('❌ Failed to restore trip:', err);
				throw err;
			}
		},

		/**
		 * Permanently delete a trip from trash (offline-first)
		 */
		async permanentDelete(id: string, userId: string) {
			try {
				const db = await getDB();
				
				// 1. Verify existence
				const trashTx = db.transaction('trash', 'readonly');
				const trashItem = await trashTx.objectStore('trash').get(id);
				if (!trashItem) return; 

				// 2. Delete locally
				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				// 3. Update UI & Queue Sync
				update((items) => items.filter((item) => item.id !== id));
				await syncManager.addToQueue({ action: 'permanentDelete', tripId: id });
			} catch (err) {
				console.error('❌ Failed to permanently delete trip:', err);
			}
		},

		/**
		 * Empty all trash items
		 */
		async emptyTrash(userId: string) {
			try {
				const db = await getDB();

				// 1. Get user items
				const getTx = db.transaction('trash', 'readonly');
				const index = getTx.objectStore('trash').index('userId');
				const userItems = await index.getAll(userId);

				if (userItems.length === 0) return 0;

				// 2. Delete locally
				const deleteTx = db.transaction('trash', 'readwrite');
				const store = deleteTx.objectStore('trash');
				for (const item of userItems) {
					await store.delete(item.id);
				}
				await deleteTx.done;

				// 3. Update UI & Queue Sync
				set([]);
				for (const item of userItems) {
					await syncManager.addToQueue({ action: 'permanentDelete', tripId: item.id });
				}

				return userItems.length;
			} catch (err) {
				console.error('❌ Failed to empty trash:', err);
				return 0;
			}
		},

		/**
		 * Sync from cloud (Robust Normalization)
		 */
		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) return;

				const response = await fetch('/api/trash');
				if (!response.ok) return;

				const cloudTrash = await response.json();
				const cloudIds = new Set<string>();

				const db = await getDB();
				const tx = db.transaction('trash', 'readwrite');
				const store = tx.objectStore('trash');

				// 1. Process Cloud Items (Pull)
				for (const rawItem of cloudTrash) {
					let flatItem: any = { ...rawItem };

					// --- FIX: Normalize Nested Data Structure ---
					
                    // Case 1: Legacy format { trip: {...}, metadata: {...} }
					if (flatItem.trip) {
                        // Merge trip fields up to top level
						flatItem = { 
                            ...flatItem.trip, 
                            ...flatItem 
                        };
                        delete flatItem.trip;
					}

                    // Case 2: Handle Metadata object
					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt || flatItem.deletedAt;
						flatItem.deletedBy = flatItem.metadata.deletedBy || flatItem.deletedBy;
						flatItem.expiresAt = flatItem.metadata.expiresAt || flatItem.expiresAt;
						flatItem.originalKey = flatItem.metadata.originalKey || flatItem.originalKey;
						delete flatItem.metadata;
					}
                    // ---------------------------------------------

                    // Verify ID exists before saving
                    if (!flatItem.id) {
                        console.warn('⚠️ Skipping malformed trash item:', flatItem);
                        continue;
                    }

                    // Track ID as "seen" in cloud
                    cloudIds.add(flatItem.id);

					const local = await store.get(flatItem.id);
					
                    // Update if cloud is newer or local missing
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}

				// 2. Reconciliation (Clean up local items not in cloud)
                // Get all local items for this user
				const index = store.index('userId');
				const localTrashItems = await index.getAll(userId);

				for (const localItem of localTrashItems) {
                    // If not in cloud AND not pending upload... delete it.
					if (!cloudIds.has(localItem.id)) {
						if (localItem.syncStatus === 'pending') {
                            // Keep pending items!
							continue;
						}
                        
						await store.delete(localItem.id);
					}
				}

				await tx.done;
				await this.load(userId);
                
			} catch (err) {
				console.error('❌ Failed to sync trash from cloud:', err);
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