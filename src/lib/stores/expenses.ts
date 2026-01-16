// src/lib/stores/expenses.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { ExpenseRecord } from '$lib/db/types';
import type { User } from '$lib/types';

import { auth } from '$lib/stores/auth';
import { PLAN_LIMITS } from '$lib/constants';

export const isLoading = writable(false);

function createExpensesStore() {
	const { subscribe, set, update } = writable<ExpenseRecord[]>([]);
	let _hydrationPromise: Promise<void> | null = null;
	const _resolveHydration: any = null;

	return {
		subscribe,
		set,

		// [!code fix] Smart Hydrate: Removes stale items (deleted on other devices)
		async hydrate(data: ExpenseRecord[], _userId?: string) {
			// Intentionally unused parameter retained for call-site compatibility
			void _userId;
			try {
				const db = await getDB();

				// 1. Check Trash to prevent resurrection of locally deleted items
				const trashTx = db.transaction('trash', 'readonly');
				const trashItems = await trashTx.objectStore('trash').getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));
				await trashTx.done;

				// 2. Prepare Valid Data (Server data minus local trash)
				const validServerData = data.filter((item) => !trashIds.has(item.id));
				const serverIdSet = new Set(validServerData.map((i) => i.id));

				// 3. Update Screen Immediately
				set(validServerData);

				// 4. Update DB (ReadWrite)
				const tx = db.transaction(['expenses', 'trash'], 'readwrite');
				const store = tx.objectStore('expenses');

				// Get all local items to check for zombies (stale items)
				const localItems = await store.getAll();

				for (const local of localItems) {
					// DELETE if:
					// a) It is in the local Trash
					// b) OR It is marked as 'synced' locally, but missing from server list (Deleted remotely)
					// (We skip 'pending' items because those are new local creations waiting to upload)
					const isTrash = trashIds.has(local.id);
					const isStale = local.syncStatus === 'synced' && !serverIdSet.has(local.id);

					if (isTrash || isStale) {
						await store.delete(local.id);
					}
				}

				// UPDATE/INSERT fresh server data
				for (const item of validServerData) {
					await store.put({ ...item, syncStatus: 'synced' });
				}

				await tx.done;
				if (_resolveHydration) _resolveHydration();
				_hydrationPromise = null;
			} catch (err) {
				console.error('Failed to hydrate expenses:', err);
				// Fallback: just trust the server data
				set(data);
				if (_resolveHydration) _resolveHydration();
				_hydrationPromise = null;
			}
		},

		updateLocal(expense: ExpenseRecord) {
			update((items) => {
				const index = items.findIndex((e) => e.id === expense.id);
				if (index !== -1) {
					const newItems = [...items];
					newItems[index] = { ...newItems[index], ...expense };
					return newItems;
				} else {
					return [expense, ...items].sort(
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
				const tx = db.transaction(['expenses', 'trash'], 'readonly');
				const store = tx.objectStore('expenses');
				const trashStore = tx.objectStore('trash');

				let expenses: ExpenseRecord[];

				if (userId) {
					const index = store.index('userId');
					expenses = await index.getAll(userId);
				} else {
					expenses = await store.getAll();
				}

				const trashItems = await trashStore.getAll();
				const trashIds = new Set(trashItems.map((t: any) => t.id));

				const activeItems = expenses.filter((e) => !trashIds.has(e.id));

				activeItems.sort((a, b) => {
					const dateA = new Date(a.date || a.createdAt).getTime();
					const dateB = new Date(b.date || b.createdAt).getTime();
					return dateB - dateA;
				});

				set(activeItems);
				return activeItems;
			} catch (err) {
				console.error('❌ Failed to load expenses:', err);
				set([]);
				return [];
			} finally {
				isLoading.set(false);
			}
		},

		async create(expenseData: Partial<ExpenseRecord>, userId: string) {
			try {
				const currentUser = (get(auth) as { user?: User | null }).user;
				const isFreeTier = !currentUser?.plan || currentUser.plan === 'free';
				if (isFreeTier) {
					const db = await getDB();
					const tx = db.transaction('expenses', 'readonly');
					const index = tx.objectStore('expenses').index('userId');
					const allExpenses = await index.getAll(userId);

					const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
					const windowMs = windowDays * 24 * 60 * 60 * 1000;
					const cutoff = new Date(Date.now() - windowMs);

					const recentCount = allExpenses.filter(
						(e) => new Date(e.date || e.createdAt) >= cutoff
					).length;
					const allowed =
						PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH ||
						PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW ||
						20;
					if (recentCount >= allowed) {
						throw new Error(
							`Free tier limit reached (${allowed} expenses per ${windowDays} days).`
						);
					}
				}

				const expense: ExpenseRecord = {
					...expenseData,
					id: expenseData.id || crypto.randomUUID(),
					userId,
					createdAt: expenseData.createdAt || new Date().toISOString(),
					updatedAt: expenseData.updatedAt || new Date().toISOString(),
					syncStatus: 'pending'
				} as ExpenseRecord;

				update((items) => [expense, ...items]);

				const db = await getDB();
				const tx = db.transaction('expenses', 'readwrite');
				await tx.objectStore('expenses').put(expense);
				await tx.done;

				await syncManager.addToQueue({
					action: 'create',
					tripId: expense.id,
					data: { ...expense, store: 'expenses' }
				});

				return expense;
			} catch (err) {
				console.error('❌ Failed to create expense:', err);
				// Revert on error
				this.load(userId);
				throw err;
			}
		},

		async updateExpense(id: string, changes: Partial<ExpenseRecord>, userId: string) {
			update((items) =>
				items.map((e) =>
					e.id === id ? { ...e, ...changes, updatedAt: new Date().toISOString() } : e
				)
			);

			try {
				const db = await getDB();
				const tx = db.transaction('expenses', 'readwrite');
				const store = tx.objectStore('expenses');

				const existing = await store.get(id);
				if (!existing) throw new Error('Expense not found');
				if (existing.userId !== userId) throw new Error('Unauthorized');

				const updated = {
					...existing,
					...changes,
					id,
					userId,
					updatedAt: new Date().toISOString(),
					syncStatus: 'pending'
				};

				await store.put(updated);
				await tx.done;

				await syncManager.addToQueue({
					action: 'update',
					tripId: id,
					data: { ...updated, store: 'expenses' }
				});

				return updated;
			} catch (err) {
				console.error('❌ Failed to update expense:', err);
				this.load(userId);
				throw err;
			}
		},

		async deleteExpense(id: string, userId: string) {
			let previousExpenses: ExpenseRecord[] = [];
			update((current) => {
				previousExpenses = current;
				return current.filter((e) => e.id !== id);
			});

			try {
				console.log('🗑️ Moving expense to trash:', id);
				const db = await getDB();

				// Single transaction for both stores to prevent locks
				const tx = db.transaction(['expenses', 'trash'], 'readwrite');
				const store = tx.objectStore('expenses');
				const trashStore = tx.objectStore('trash');

				const rec = await store.get(id);
				if (!rec) {
					// Already gone locally? Just ensure sync sends delete
					await tx.done;
					await syncManager.addToQueue({
						action: 'delete',
						tripId: id,
						data: { store: 'expenses' }
					});
					return;
				}

				if (rec.userId !== userId) {
					await tx.done;
					this.load(userId);
					throw new Error('Unauthorized');
				}

				const now = new Date();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

				const trashItem = {
					id: rec.id,
					type: 'expense',
					recordType: 'expense',
					data: rec,
					deletedAt: now.toISOString(),
					deletedBy: userId,
					expiresAt: expiresAt.toISOString(),
					originalKey: `expense:${userId}:${id}`,
					syncStatus: 'pending' as const,
					amount: rec.amount,
					category: rec.category,
					description: rec.description
				};

				await trashStore.put(trashItem);
				await store.delete(id);
				await tx.done;

				// [!code fix] Force reload to ensure disk sync matches UI
				await this.load(userId);

				await syncManager.addToQueue({
					action: 'delete',
					tripId: id,
					data: { store: 'expenses' }
				});

				console.log('✅ Expense moved to trash:', id);
			} catch (err) {
				console.error('❌ Failed to delete expense:', err);
				set(previousExpenses); // Revert on failure
				throw err;
			}
		},

		async get(id: string, userId: string) {
			try {
				const db = await getDB();
				const tx = db.transaction('expenses', 'readonly');
				const expense = await tx.objectStore('expenses').get(id);
				if (!expense || expense.userId !== userId) return null;
				return expense;
			} catch (err) {
				console.error('❌ Failed to get expense:', err);
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

				const lastSync = localStorage.getItem('last_sync_expenses');
				const sinceDate = lastSync ? new Date(new Date(lastSync).getTime() - 5 * 60 * 1000) : null;

				const url = sinceDate
					? `/api/expenses?since=${encodeURIComponent(sinceDate.toISOString())}`
					: '/api/expenses';

				console.log(
					`☁️ Syncing expenses... ${lastSync ? `(Delta since ${sinceDate?.toISOString()})` : '(Full)'}`
				);

				const response = await fetch(url, { credentials: 'include' });
				if (!response.ok) throw new Error('Failed to fetch expenses');

				const cloudExpenses: any = await response.json();

				if (cloudExpenses.length > 0) {
					const db = await getDB();
					const tx = db.transaction(['expenses', 'trash'], 'readwrite');
					const store = tx.objectStore('expenses');
					const trashStore = tx.objectStore('trash');

					const trashKeys = await trashStore.getAllKeys();
					const trashIds = new Set(trashKeys.map(String));

					for (const cloudExpense of cloudExpenses) {
						// 1. Handle Server Deletes
						if (cloudExpense.deleted) {
							const local = await store.get(cloudExpense.id);
							if (local) await store.delete(cloudExpense.id);
							continue;
						}

						// 2. Prevent Resurrection of local trash
						if (trashIds.has(cloudExpense.id)) continue;

						// 3. Update/Create
						const local = await store.get(cloudExpense.id);
						if (!local || new Date(cloudExpense.updatedAt) > new Date(local.updatedAt)) {
							await store.put({
								...cloudExpense,
								syncStatus: 'synced',
								lastSyncedAt: new Date().toISOString()
							});
						}
					}
					await tx.done;
				}
				localStorage.setItem('last_sync_expenses', new Date().toISOString());
			} catch (err) {
				console.error('❌ Failed to sync expenses from cloud:', err);
			} finally {
				// Ensure hydration (if running) completes before loading DB to avoid races
				if (_hydrationPromise) await _hydrationPromise;
				await this.load(userId);
				isLoading.set(false);
			}
		},

		async migrateOfflineExpenses(tempUserId: string, realUserId: string) {
			if (!tempUserId || !realUserId || tempUserId === realUserId) return;
			const db = await getDB();
			const tx = db.transaction('expenses', 'readwrite');
			const store = tx.objectStore('expenses');
			const index = store.index('userId');
			const offlineExpenses = await index.getAll(tempUserId);

			for (const expense of offlineExpenses) {
				expense.userId = realUserId;
				expense.syncStatus = 'pending';
				expense.updatedAt = new Date().toISOString();
				await store.put(expense);
				await syncManager.addToQueue({
					action: 'create',
					tripId: expense.id,
					data: { ...expense, store: 'expenses' }
				});
			}
			await tx.done;
			await this.load(realUserId);
		}
	};
}

export const expenses = createExpensesStore();

syncManager.registerStore('expenses', {
	updateLocal: (item) => {
		if (item && item.amount !== undefined && item.category !== undefined) {
			expenses.updateLocal(item);
		}
	},
	syncDown: async () => {
		const user = (get(auth) as { user?: User | null }).user;
		if (user?.id) await expenses.syncFromCloud(user.id);
	}
});

function createDraftStore() {
	const STORAGE_KEY = 'draft_expense';

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

export const draftExpense = createDraftStore();
