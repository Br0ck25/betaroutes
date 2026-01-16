import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { MillageRecord } from '$lib/db/types';
import type { User } from '$lib/types';
import { auth } from '$lib/stores/auth';

export const isLoading = writable(false);

function createMillageStore() {
	const { subscribe, set, update } = writable<MillageRecord[]>([]);

	return {
		subscribe,
		set,

		// Method to hydrate from server data (SSR) + persist to local DB
		async hydrate(data: MillageRecord[], userId: string) {
			try {
				const db = await getDB();
				
				// 1. Get all local trash IDs to prevent resurrection
				const trashTx = db.transaction('trash', 'readonly');
				const trashItems = await trashTx.objectStore('trash').getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));
				await trashTx.done;

				// 2. Filter server data
				const validData = data.filter((item) => !trashIds.has(item.id));
				
				// 3. Update Screen Immediately
				set(validData);

				// 4. Update Local Database
				const tx = db.transaction(['millage', 'trash'], 'readwrite');
				const store = tx.objectStore('millage');
				
				for (const item of validData) {
					await store.put({ ...item, syncStatus: 'synced' });
				}

				// 5. Cleanup zombies (active items that should be in trash)
				for (const serverItem of data) {
					if (trashIds.has(serverItem.id)) {
						const existing = await store.get(serverItem.id);
						if (existing) {
							await store.delete(serverItem.id);
						}
					}
				}
				await tx.done;
			} catch (err) {
				console.error('Failed to hydrate millage cache:', err);
				set(data);
			}
		},

		updateLocal(record: MillageRecord) {
			update((items) => {
				const index = items.findIndex((r) => r.id === record.id);
				if (index !== -1) {
					const newItems = [...items];
					newItems[index] = { ...newItems[index], ...record };
					return newItems;
				} else {
					return [record, ...items].sort(
						(a, b) =>
							new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
					);
				}
			});
		},

		async load(userId?: string) {
			isLoading.set(true);
			try {
				const db = await getDB();
				const tx = db.transaction(['millage', 'trash'], 'readonly');
				const store = tx.objectStore('millage');
				const trashStore = tx.objectStore('trash');

				let items: MillageRecord[];
				if (userId) {
					const index = store.index('userId');
					items = await index.getAll(userId);
				} else {
					items = await store.getAll();
				}

				const trashItems = await trashStore.getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));

				// Filter out trashed items
				const activeItems = items.filter(item => !trashIds.has(item.id));

				activeItems.sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});

				set(activeItems);
				return activeItems;
			} catch (err) {
				console.error('❌ Failed to load millage:', err);
				set([]);
				return [];
			} finally {
				isLoading.set(false);
			}
		},

		async create(data: Partial<MillageRecord>, userId: string) {
			const record: MillageRecord = {
				...data,
				id: data.id || crypto.randomUUID(),
				userId,
				date: data.date || new Date().toISOString(),
				startOdometer: (data.startOdometer as number) || 0,
				endOdometer: (data.endOdometer as number) || 0,
				miles:
					typeof data.miles === 'number'
						? data.miles
						: Math.max(0, Number(data.endOdometer) - Number(data.startOdometer)),
				millageRate: typeof data.millageRate === 'number' ? data.millageRate : undefined,
				vehicle: data.vehicle || undefined,
				reimbursement: data.reimbursement,
				notes: data.notes || '',
				createdAt: data.createdAt || new Date().toISOString(),
				updatedAt: data.updatedAt || new Date().toISOString(),
				syncStatus: 'pending'
			};

			update((items) => [record, ...items]);

			try {
				const db = await getDB();
				const tx = db.transaction('millage', 'readwrite');
				await tx.objectStore('millage').put(record);
				await tx.done;

				await syncManager.addToQueue({
					action: 'create',
					tripId: record.id,
					data: { ...record, store: 'millage' }
				});

				return record;
			} catch (err) {
				console.error('❌ Failed to create millage record:', err);
				this.load(userId);
				throw err;
			}
		},

		async updateMillage(id: string, changes: Partial<MillageRecord>, userId: string) {
			update((items) =>
				items.map((r) =>
					r.id === id ? { ...r, ...changes, updatedAt: new Date().toISOString() } : r
				)
			);

			try {
				const db = await getDB();
				const tx = db.transaction('millage', 'readwrite');
				const store = tx.objectStore('millage');

				const existing = await store.get(id);
				if (!existing) throw new Error('Millage record not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');

				const updated: MillageRecord = {
					...existing,
					...changes,
					id,
					userId,
					updatedAt: new Date().toISOString(),
					syncStatus: 'pending'
				};

				if (typeof updated.startOdometer === 'number' && typeof updated.endOdometer === 'number') {
					updated.miles = Math.max(0, updated.endOdometer - updated.startOdometer);
				}

				if (typeof updated.millageRate === 'string') {
					const n = Number(updated.millageRate);
					updated.millageRate = isNaN(n) ? undefined : n;
				}

				await store.put(updated);
				await tx.done;

				await syncManager.addToQueue({
					action: 'update',
					tripId: id,
					data: { ...updated, store: 'millage' }
				});

				return updated;
			} catch (err) {
				console.error('❌ Failed to update millage:', err);
				this.load(userId);
				throw err;
			}
		},

		async deleteMillage(id: string, userId: string) {
			// 1. Optimistic Update
			update((current) => current.filter((r) => r.id !== id));

			try {
				const db = await getDB();

				// Single transaction for atomicity
				const tx = db.transaction(['millage', 'trash'], 'readwrite');
				const millageStore = tx.objectStore('millage');
				const trashStore = tx.objectStore('trash');

				const rec = await millageStore.get(id);

				if (!rec) {
					await tx.done;
					await syncManager.addToQueue({
						action: 'delete',
						tripId: id,
						data: { store: 'millage' }
					});
					return;
				}

				if (rec.userId !== userId) {
					await tx.done;
					throw new Error('Unauthorized');
				}

				const now = new Date();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

				const trashItem = {
					id: rec.id,
					type: 'millage',
					recordType: 'millage',
					data: rec,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					originalKey: `millage:${userId}:${id}`,
					syncStatus: 'pending',
					miles: rec.miles,
					vehicle: rec.vehicle,
					date: rec.date
				};

				await trashStore.put(trashItem);
				await millageStore.delete(id);
				await tx.done;

				// [!code fix] FORCE RELOAD from DB to ensure UI is perfectly synced with disk
				// This mimics the Trash page behavior which re-fetches data after operation.
				await this.load(userId);

				await syncManager.addToQueue({
					action: 'delete',
					tripId: id,
					data: { store: 'millage' }
				});
			} catch (err) {
				console.error('❌ Failed to delete millage record:', err);
				this.load(userId); // Revert on failure
				throw err;
			}
		},

		async get(id: string, userId: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('millage', 'readonly');
				const item = await tx.objectStore('millage').get(id);
				if (!item || item.userId !== userId) return null;
				return item;
			} catch (err) {
				return null;
			}
		},

		clear() {
			set([]);
		},

		async syncFromCloud(userId: string) {
			isLoading.set(true);
			try {
				if (!navigator.onLine) return;

				const lastSync = localStorage.getItem('last_sync_millage');
				const sinceDate = lastSync ? new Date(new Date(lastSync).getTime() - 5 * 60 * 1000) : null;

				const url = sinceDate
					? `/api/millage?since=${encodeURIComponent(sinceDate.toISOString())}`
					: '/api/millage';

				const response = await fetch(url);
				if (!response.ok) throw new Error('Failed to fetch millage');

				const cloud: any = await response.json();

				if (cloud.length > 0) {
					const db = await getDB();
					const tx = db.transaction(['millage', 'trash'], 'readwrite');
					const store = tx.objectStore('millage');
					const trashStore = tx.objectStore('trash');
					
					const trashKeys = await trashStore.getAllKeys();
					const trashIds = new Set(trashKeys.map(String));

					for (const rec of cloud) {
						if (rec.deleted) {
							const local = await store.get(rec.id);
							if (local) await store.delete(rec.id);
							continue;
						}

						if (trashIds.has(rec.id)) continue;

						const local = await store.get(rec.id);
						if (!local || new Date(rec.updatedAt) > new Date(local.updatedAt)) {
							await store.put({
								...rec,
								syncStatus: 'synced',
								lastSyncedAt: new Date().toISOString()
							});
						}
					}
					await tx.done;
				}
				localStorage.setItem('last_sync_millage', new Date().toISOString());
			} catch (err) {
				console.error('❌ Failed to sync millage from cloud:', err);
			} finally {
				await this.load(userId);
				isLoading.set(false);
			}
		},

		async migrateOfflineMillage(tempUserId: string, realUserId: string) {
			if (!tempUserId || !realUserId || tempUserId === realUserId) return;
			const db = await getDB();
			const tx = db.transaction('millage', 'readwrite');
			const store = tx.objectStore('millage');
			const index = store.index('userId');
			const offline = await index.getAll(tempUserId);

			for (const r of offline) {
				r.userId = realUserId;
				r.syncStatus = 'pending';
				r.updatedAt = new Date().toISOString();
				await store.put(r);
				await syncManager.addToQueue({
					action: 'create',
					tripId: r.id,
					data: { ...r, store: 'millage' }
				});
			}
			await tx.done;
			await this.load(realUserId);
		}
	};
}

export const millage = createMillageStore();

syncManager.registerStore('millage', {
	updateLocal: (item) => {
		if (item && typeof (item as any).miles === 'number') {
			millage.updateLocal(item as MillageRecord);
		}
	},
	syncDown: async () => {
		const user = (get(auth) as { user?: User | null }).user;
		if (user?.id) await millage.syncFromCloud(user.id);
	}
});

function createDraftStore() {
	const STORAGE_KEY = 'draft_millage';

	const getDraft = () => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			return stored ? JSON.parse(stored) : null;
		} catch {
			return null;
		}
	};

	const { subscribe, set } = writable(getDraft());

	return {
		subscribe,
		save: (data: any) => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
			set(data);
		},
		load: () => getDraft(),
		clear: () => {
			localStorage.removeItem(STORAGE_KEY);
			set(null);
		}
	};
}

export const draftMillage = createDraftStore();