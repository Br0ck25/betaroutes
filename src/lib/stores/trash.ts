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
				let items = userId ? await store.index('userId').getAll(userId) : await store.getAll();
				items.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
				set(items);
				return items;
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

				const restoredItem = { ...trashItem };
				delete (restoredItem as any).deletedAt;
				delete (restoredItem as any).deletedBy;
				delete (restoredItem as any).expiresAt;
				const originalKey = restoredItem.originalKey;
                delete (restoredItem as any).originalKey;
                delete (restoredItem as any).recordType;

				restoredItem.updatedAt = new Date().toISOString();
				restoredItem.syncStatus = 'pending';

                // Detect type and restore to correct store
                if (originalKey && originalKey.startsWith('expense:')) {
                    const tx = db.transaction('expenses', 'readwrite');
				    await tx.objectStore('expenses').put(restoredItem);
				    await tx.done;
                } else {
                    // Default to trips
                    const tx = db.transaction('trips', 'readwrite');
				    await tx.objectStore('trips').put(restoredItem);
				    await tx.done;
                }

				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				update((items) => items.filter((item) => item.id !== id));
				await syncManager.addToQueue({ action: 'restore', tripId: id });

				return restoredItem;
			} catch (err) {
				console.error('❌ Failed to restore item:', err);
				throw err;
			}
		},

		async permanentDelete(id: string, userId: string) {
			const db = await getDB();
            const tx = db.transaction('trash', 'readwrite');
            await tx.objectStore('trash').delete(id);
            await tx.done;
            update(l => l.filter(t => t.id !== id));
            await syncManager.addToQueue({ action: 'permanentDelete', tripId: id });
		},

		async emptyTrash(userId: string) {
            const db = await getDB();
            const userItems = await db.getAllFromIndex('trash', 'userId', userId);
            if (userItems.length === 0) return 0;

            const tx = db.transaction('trash', 'readwrite');
            for(const item of userItems) await tx.store.delete(item.id);
            await tx.done;
            set([]);

            for(const item of userItems) {
                await syncManager.addToQueue({ action: 'permanentDelete', tripId: item.id });
            }
            return userItems.length;
		},

		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) return;

				const response = await fetch('/api/trash');
				if (!response.ok) return;

				const cloudTrash = await response.json();
				const cloudIds = new Set<string>();

				const db = await getDB();
				const tx = db.transaction('trash', 'readwrite');
				
				for (const rawItem of cloudTrash) {
                    // Normalize Item
					let flatItem: any = { ...rawItem };
                    
                    // Handle generic 'data' wrapper if present from new API
                    if (flatItem.data) {
                         // Merge data up
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
                    if (!flatItem.recordType) {
                        if (flatItem.originalKey?.startsWith('expense:')) flatItem.recordType = 'expense';
                        else flatItem.recordType = 'trip';
                    }

                    cloudIds.add(flatItem.id);

					const local = await tx.store.get(flatItem.id);
					if (!local || new Date(flatItem.deletedAt) > new Date(local.deletedAt)) {
						await tx.store.put({
							...flatItem,
							syncStatus: 'synced',
							lastSyncedAt: new Date().toISOString()
						});
					}
				}
                
                // Reconciliation
				const index = tx.store.index('userId');
				const localItems = await index.getAll(userId);
				for (const localItem of localItems) {
					if (!cloudIds.has(localItem.id)) {
						if (localItem.syncStatus === 'pending') continue; 
						await tx.store.delete(localItem.id);
					}
				}
				await tx.done;

                // Cleanup Active Stores (Safety Check)
                const cleanupTx = db.transaction(['trash', 'trips', 'expenses'], 'readwrite');
                const allTrash = await cleanupTx.objectStore('trash').getAll();
                const tripStore = cleanupTx.objectStore('trips');
                const expenseStore = cleanupTx.objectStore('expenses');
                
                for(const trashItem of allTrash) {
                    // Remove from active trips
                    if (await tripStore.get(trashItem.id)) {
                        await tripStore.delete(trashItem.id);
                    }
                    // Remove from active expenses
                    if (await expenseStore.get(trashItem.id)) {
                         await expenseStore.delete(trashItem.id);
                    }
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

		clear() { set([]); }
	};
}

export const trash = createTrashStore();