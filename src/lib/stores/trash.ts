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
            // ... (keep existing restore logic) ...
            try {
				const db = await getDB();
				const trashTx = db.transaction('trash', 'readonly');
				const trashItem = await trashTx.objectStore('trash').get(id);

				if (!trashItem) throw new Error('Item not found in trash');
				if (trashItem.userId !== userId) throw new Error('Unauthorized');

				const restoredTrip = { ...trashItem };
				delete (restoredTrip as any).deletedAt;
				delete (restoredTrip as any).deletedBy;
				delete (restoredTrip as any).expiresAt;
				delete (restoredTrip as any).originalKey;

				restoredTrip.updatedAt = new Date().toISOString();
				restoredTrip.syncStatus = 'pending';

				const tripsTx = db.transaction('trips', 'readwrite');
				await tripsTx.objectStore('trips').put(restoredTrip);
				await tripsTx.done;

				const deleteTx = db.transaction('trash', 'readwrite');
				await deleteTx.objectStore('trash').delete(id);
				await deleteTx.done;

				update((items) => items.filter((item) => item.id !== id));
				await syncManager.addToQueue({ action: 'restore', tripId: id });

				return restoredTrip;
			} catch (err) {
				console.error('❌ Failed to restore trip:', err);
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
			// ... (keep existing emptyTrash logic) ...
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

        // --- UPDATED SYNC LOGIC ---
		async syncFromCloud(userId: string) {
			try {
				if (!navigator.onLine) return;

				const response = await fetch('/api/trash');
				if (!response.ok) return;

				const cloudTrash = await response.json();
				const cloudIds = new Set<string>();

				const db = await getDB();
				
                // Transaction 1: Update Trash Store
				const tx = db.transaction('trash', 'readwrite');
				
				for (const rawItem of cloudTrash) {
                    // Normalize Item
					let flatItem: any = { ...rawItem };
					if (flatItem.trip) flatItem = { ...flatItem.trip, ...flatItem };
                    delete flatItem.trip;

					if (flatItem.metadata) {
						flatItem.deletedAt = flatItem.metadata.deletedAt || flatItem.deletedAt;
						flatItem.expiresAt = flatItem.metadata.expiresAt || flatItem.expiresAt;
						delete flatItem.metadata;
					}
                    
                    if (!flatItem.id) continue;
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

                // Transaction 2: CLEAN UP ACTIVE TRIPS
                // If an item is in Trash, it MUST NOT be in Trips
                const cleanupTx = db.transaction(['trash', 'trips'], 'readwrite');
                const allTrash = await cleanupTx.objectStore('trash').getAll();
                const tripStore = cleanupTx.objectStore('trips');
                
                for(const trashItem of allTrash) {
                    const existsInTrips = await tripStore.get(trashItem.id);
                    if(existsInTrips) {
                        console.log(`🗑️ Removing active trip ${trashItem.id} because it exists in trash`);
                        await tripStore.delete(trashItem.id);
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