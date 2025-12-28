// src/lib/stores/expenses.ts
import { writable, get } from 'svelte/store';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { ExpenseRecord } from '$lib/db/types';

import { auth } from '$lib/stores/auth';
import { PLAN_LIMITS } from '$lib/constants';

export const isLoading = writable(false);

function createExpensesStore() {
    const { subscribe, set, update } = writable<ExpenseRecord[]>([]);

    return {
        subscribe,

        // Updates local store without DB write
        // Used by SyncManager to reflect background changes in the UI instantly
        updateLocal(expense: ExpenseRecord) {
            update(items => {
                const index = items.findIndex(e => e.id === expense.id);
                if (index !== -1) {
                    // Update existing
                    const newItems = [...items];
                    newItems[index] = { ...newItems[index], ...expense };
                    return newItems;
                } else {
                    // [!code ++] Insert new (Upsert) - useful for restores/sync
                    return [expense, ...items].sort((a, b) => 
                        new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
                    );
                }
            });
        },

        async load(userId?: string) {
            isLoading.set(true);
            try {
                const db = await getDB();
                const tx = db.transaction('expenses', 'readonly');
                const store = tx.objectStore('expenses');

                let expenses: ExpenseRecord[];

                if (userId) {
                    const index = store.index('userId');
                    expenses = await index.getAll(userId);
                } else {
                    expenses = await store.getAll();
                }

                // Sort by date descending (newest first)
                expenses.sort((a, b) => {
                    const dateA = new Date(a.date || a.createdAt).getTime();
                    const dateB = new Date(b.date || b.createdAt).getTime();
                    return dateB - dateA;
                });

                set(expenses);
                return expenses;
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
                // Free Tier Check (rolling window)
                const currentUser = get(auth).user;
                const isFreeTier = !currentUser?.plan || currentUser.plan === 'free';
                if (isFreeTier) {
                    const db = await getDB();
                    const tx = db.transaction('expenses', 'readonly');
                    const index = tx.objectStore('expenses').index('userId');
                    const allExpenses = await index.getAll(userId);

                    const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
                    const windowMs = windowDays * 24 * 60 * 60 * 1000;
                    const cutoff = new Date(Date.now() - windowMs);

                    const recentCount = allExpenses.filter(e => new Date(e.date || e.createdAt) >= cutoff).length;
                    const allowed = PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH || PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW || 20;
                    if (recentCount >= allowed) {
                        throw new Error(`Free tier limit reached (${allowed} expenses per ${windowDays} days).`);
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

                // 1. Save to Local DB
                const db = await getDB();
                const tx = db.transaction('expenses', 'readwrite');
                await tx.objectStore('expenses').put(expense);
                await tx.done;

                // 2. Update Svelte Store immediately
                update((expenses) => {
                    const exists = expenses.find(e => e.id === expense.id);
                    if (exists) return expenses.map(e => e.id === expense.id ? expense : e);
                    return [expense, ...expenses];
                });

                // 3. Queue for Sync
                await syncManager.addToQueue({
                    action: 'create',
                    tripId: expense.id, // Using tripId to satisfy SyncQueueItem interface
                    data: { ...expense, store: 'expenses' } // Tag data with store name for worker
                });

                return expense;
            } catch (err) {
                console.error('❌ Failed to create expense:', err);
                throw err;
            }
        },

        async updateExpense(id: string, changes: Partial<ExpenseRecord>, userId: string) {
            try {
                const db = await getDB();
                const tx = db.transaction('expenses', 'readwrite');
                const store = tx.objectStore('expenses');

                const existing = await store.get(id);
                if (!existing) throw new Error('Expense not found');
                if (existing.userId !== userId) throw new Error('Unauthorized');

                const updated: ExpenseRecord = {
                    ...existing,
                    ...changes,
                    id,
                    userId,
                    updatedAt: new Date().toISOString(),
                    syncStatus: 'pending'
                };

                await store.put(updated);
                await tx.done;

                update((expenses) => expenses.map((e) => (e.id === id ? updated : e)));

                await syncManager.addToQueue({
                    action: 'update',
                    tripId: id, // Using tripId to satisfy SyncQueueItem interface
                    data: { ...updated, store: 'expenses' }
                });

                return updated;
            } catch (err) {
                console.error('❌ Failed to update expense:', err);
                throw err;
            }
        },

        async deleteExpense(id: string, userId: string) {
            // Optimistic Update: Remove from UI immediately
            let previousExpenses: ExpenseRecord[] = [];
            update(current => {
                previousExpenses = current;
                return current.filter(e => e.id !== id);
            });

            try {
                console.log('🗑️ Moving expense to trash:', id);
                const db = await getDB();

                // 1. Verify Ownership
                const expensesTx = db.transaction('expenses', 'readonly');
                const expense = await expensesTx.objectStore('expenses').get(id);
                if (!expense) throw new Error('Expense not found');
                if (expense.userId !== userId) throw new Error('Unauthorized');

                const now = new Date();
                const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

                const trashItem = {
                    ...expense,
                    deletedAt: now.toISOString(),
                    deletedBy: userId,
                    expiresAt: expiresAt.toISOString(),
                    originalKey: `expense:${userId}:${id}`,
                    syncStatus: 'pending' as const
                };

                // 2. Move to Trash Store
                // Note: Ensure your TrashRecord type is compatible with ExpenseRecord or generic
                const trashTx = db.transaction('trash', 'readwrite');
                await trashTx.objectStore('trash').put(trashItem);
                await trashTx.done;

                // 3. Remove from Expenses Store
                const deleteTx = db.transaction('expenses', 'readwrite');
                await deleteTx.objectStore('expenses').delete(id);
                await deleteTx.done;

                // 4. Queue Sync Action
                await syncManager.addToQueue({
                    action: 'delete',
                    tripId: id,
                    data: { store: 'expenses' } // Tag data so worker knows which API endpoint to hit
                });

                console.log('✅ Expense moved to trash:', id);
            } catch (err) {
                console.error('❌ Failed to delete expense:', err);
                // Revert UI if failed
                set(previousExpenses);
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
                
                // Note: You may need to add get/setLastExpenseSync to your storage utils
                // For now, using a distinct key for expenses sync time
                const lastSync = localStorage.getItem('last_sync_expenses');
                const url = lastSync 
                    ? `/api/expenses?since=${encodeURIComponent(lastSync)}` 
                    : '/api/expenses';

                console.log(`☁️ Syncing expenses from cloud... ${lastSync ? `(Delta since ${lastSync})` : '(Full)'}`);

                const response = await fetch(url);
                if (!response.ok) throw new Error('Failed to fetch expenses');
                
                const cloudExpenses: any = await response.json();
                
                if (cloudExpenses.length === 0) {
                     console.log('☁️ No new expense changes from cloud.');
                     localStorage.setItem('last_sync_expenses', new Date().toISOString());
                     return;
                }
                
                const db = await getDB();

                // Get Trash IDs to prevent reviving deleted items
                const trashTx = db.transaction('trash', 'readonly');
                const trashStore = trashTx.objectStore('trash');
                const trashItems = await trashStore.getAll();
                const trashIds = new Set(trashItems.map((t: any) => t.id));
                await trashTx.done;

                // Merge Logic
                const tx = db.transaction('expenses', 'readwrite');
                const store = tx.objectStore('expenses');
                
                let updateCount = 0;
                let deleteCount = 0;

                for (const cloudExpense of cloudExpenses) {
                    // Handle Soft Deletes (Tombstones)
                    if (cloudExpense.deleted) {
                        const local = await store.get(cloudExpense.id);
                        if (local) {
                            await store.delete(cloudExpense.id);
                            deleteCount++;
                            console.log('🗑️ Applying server deletion for expense:', cloudExpense.id);
                        }
                        continue;
                    }

                    if (trashIds.has(cloudExpense.id)) {
                        console.log('Skipping synced expense because it is in local trash:', cloudExpense.id);
                        continue;
                    }

                    const local = await store.get(cloudExpense.id);
                    // Last Write Wins (based on updatedAt)
                    if (!local || new Date(cloudExpense.updatedAt) > new Date(local.updatedAt)) {
                        await store.put({
                            ...cloudExpense,
                            syncStatus: 'synced',
                            lastSyncedAt: new Date().toISOString()
                        });
                        updateCount++;
                    }
                }
                await tx.done;
                
                localStorage.setItem('last_sync_expenses', new Date().toISOString());
                console.log(`✅ Processed ${cloudExpenses.length} expense changes. Updated: ${updateCount}, Deleted: ${deleteCount}.`);

                await this.load(userId);
            } catch (err) {
                console.error('❌ Failed to sync expenses from cloud:', err);
            } finally {
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

// Register Store Listener for Background Sync Updates
// Note: This listens for ANY updateLocal call from syncManager. 
// If syncManager doesn't distinguish types, this might try to update expenses with trip data.
// Ensure syncManager.ts passes the correct type or check it here if possible.
syncManager.setStoreUpdater((item) => {
    // Basic check to see if it looks like an expense (optional)
    if (item && item.amount !== undefined && item.category !== undefined) {
        expenses.updateLocal(item);
    }
});

function createDraftStore() {
    // Assuming storage utils might not have dedicated expense methods yet, 
    // we use a safe fallback or assume you will add them.
    const STORAGE_KEY = 'draft_expense';
    
    // Helper to get from storage directly if method doesn't exist
    const getDraft = () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch { return null; }
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