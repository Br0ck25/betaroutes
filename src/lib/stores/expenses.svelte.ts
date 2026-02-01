import type { ExpenseRecord, TrashRecord } from '$lib/db/types';
import { getDB } from '$lib/db/indexedDB';
import { syncManager } from '$lib/sync/syncManager';
import type { User } from '$lib/types';
import { SvelteDate, SvelteSet } from '$lib/utils/svelte-reactivity';
import { auth } from '$lib/stores/auth';
import { PLAN_LIMITS } from '$lib/constants';

// Internal reactive loading flag (runes $state must be used in top-level variable declarations)
let _isLoading = $state(false);

type CreateExpensesAPI = {
  subscribe: (run: (v: ExpenseRecord[]) => void) => () => void;
  set: (v: ExpenseRecord[]) => void;
  hydrate: (data: ExpenseRecord[], _userId?: string) => Promise<void>;
  updateLocal: (expense: ExpenseRecord) => void;
  load: (userId?: string) => Promise<ExpenseRecord[]>;
  create: (expenseData: Partial<ExpenseRecord>, userId: string) => Promise<ExpenseRecord>;
  updateExpense: (
    id: string,
    changes: Partial<ExpenseRecord>,
    userId: string
  ) => Promise<ExpenseRecord>;
  deleteExpense: (id: string, userId: string) => Promise<void>;
  get: (id: string, userId: string) => Promise<ExpenseRecord | null>;
  clear: () => void;
  syncFromCloud: (userId: string) => Promise<void>;
  migrateOfflineExpenses: (tempUserId: string, realUserId: string) => Promise<void>;
};

let items = $state<ExpenseRecord[]>([]);

let _hydrationPromise: Promise<void> | null = null;
let _resolveHydration: (() => void) | null = null;

export const expenses: CreateExpensesAPI = {
  subscribe: (run) => {
    // Basic subscription: call with current value and return a no-op unsubscribe
    run(items);
    // In runes-mode we don't provide a full reactive subscribe; consumers should use adapters if needed
    return () => undefined;
  },
  set: (v: ExpenseRecord[]) => (items = v),



  async hydrate(data: ExpenseRecord[], _userId?: string) {
    void _userId;
    _hydrationPromise = new Promise((res) => (_resolveHydration = res));
    try {
      const db = await getDB();

      const trashTx = db.transaction('trash', 'readonly');
      const trashItems = await trashTx.objectStore('trash').getAll();
      const trashIds = new SvelteSet((trashItems as TrashRecord[]).map((t: TrashRecord) => t.id));
      await trashTx.done;

      const validServerData = data.filter((item) => !trashIds.has(item.id));
      const serverIdSet = new SvelteSet(validServerData.map((i) => i.id));

      items = validServerData;

      const tx = db.transaction(['expenses', 'trash'], 'readwrite');
      const store = tx.objectStore('expenses');
      const localItems = await store.getAll();

      for (const local of localItems) {
        const isTrash = trashIds.has(local.id);
        const isStale = local.syncStatus === 'synced' && !serverIdSet.has(local.id);
        if (isTrash || isStale) await store.delete(local.id);
      }

      for (const item of validServerData) {
        await store.put({ ...item, syncStatus: 'synced' });
      }

      await tx.done;
      if (_resolveHydration) _resolveHydration();
      _hydrationPromise = null;
    } catch (err) {
      console.error('Failed to hydrate expenses:', err);
      items = data;
      if (_resolveHydration) _resolveHydration();
      _hydrationPromise = null;
    }
  },

  updateLocal(expense: ExpenseRecord) {
    const idx = items.findIndex((e: ExpenseRecord) => e.id === expense.id);
    if (idx !== -1) {
      const copy = [...items];
      copy[idx] = { ...copy[idx], ...expense };
      items = copy;
    } else {
      items = [expense, ...items].sort(
        (a, b) =>
          SvelteDate.from(b.date || b.createdAt).getTime() -
          SvelteDate.from(a.date || a.createdAt).getTime()
      );
    }
  },

  async load(this: CreateExpensesAPI, userId?: string) {
    _isLoading = true;
    try {
      const db = await getDB();
      const tx = db.transaction(['expenses', 'trash'], 'readonly');
      const store = tx.objectStore('expenses');
      const trashStore = tx.objectStore('trash');

      let loaded: ExpenseRecord[];
      const maybeStore = store as unknown as {
        index?: (name: string) => { getAll: (id?: string) => Promise<ExpenseRecord[]> };
        getAll?: () => Promise<ExpenseRecord[]>;
      };

      if (userId) {
        if (typeof maybeStore.index === 'function') {
          const index = maybeStore.index('userId');
          loaded = await index.getAll(userId);
        } else if (typeof maybeStore.getAll === 'function') {
          // Fallback for mocked DBs without indexes
          const all = await maybeStore.getAll();
          loaded = (all as ExpenseRecord[]).filter((e) => e.userId === userId);
        } else {
          loaded = [];
        }
      } else {
        if (typeof maybeStore.getAll === 'function') loaded = await maybeStore.getAll();
        else loaded = [];
      }

      const trashItems = await trashStore.getAll();
      const trashIds = new SvelteSet((trashItems as TrashRecord[]).map((t: TrashRecord) => t.id));
      const activeItems = loaded.filter((e: ExpenseRecord) => !trashIds.has(e.id));
      activeItems.sort(
        (a, b) =>
          SvelteDate.from(b.date || b.createdAt).getTime() -
          SvelteDate.from(a.date || a.createdAt).getTime()
      );

      items = activeItems;
      return activeItems;
    } catch (err) {
      console.error('❌ Failed to load expenses:', err);
      items = [];
      return [];
    } finally {
      _isLoading = false;
    }
  },

  async create(expenseData: Partial<ExpenseRecord>, userId: string) {
    try {
      const currentUser = (auth as unknown as { user?: User | null }).user ?? null;
      const isFreeTier = !currentUser?.plan || currentUser?.plan === 'free';
      if (isFreeTier) {
        const db = await getDB();
        const tx = db.transaction('expenses', 'readonly');
        const store = tx.objectStore('expenses');
        let allExpenses: ExpenseRecord[] = [];
        const maybeStore = store as unknown as {
          index?: (name: string) => { getAll: (id?: string) => Promise<ExpenseRecord[]> };
          getAll?: () => Promise<ExpenseRecord[]>;
        };

        if (typeof maybeStore.index === 'function') {
          const index = maybeStore.index('userId');
          allExpenses = await index.getAll(userId);
        } else if (typeof maybeStore.getAll === 'function') {
          // Fallback for test/mocked DBs that don't expose indexes
          allExpenses = await maybeStore.getAll();
        } else {
          allExpenses = [];
        }

        const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
        const windowMs = windowDays * 24 * 60 * 60 * 1000;
        const cutoffMs = SvelteDate.now().getTime() - windowMs;

        const recentCount = allExpenses.filter(
          (e: ExpenseRecord) => SvelteDate.from(e.date || e.createdAt).getTime() >= cutoffMs
        ).length;
        const allowed =
          PLAN_LIMITS.FREE.MAX_EXPENSES_PER_MONTH || PLAN_LIMITS.FREE.MAX_EXPENSES_IN_WINDOW || 20;
        if (recentCount >= allowed)
          throw new Error(`Free tier limit reached (${allowed} expenses per ${windowDays} days).`);
      }

      const expense: ExpenseRecord = {
        ...expenseData,
        id: expenseData.id || crypto.randomUUID(),
        userId,
        createdAt: expenseData.createdAt || SvelteDate.now().toISOString(),
        updatedAt: expenseData.updatedAt || SvelteDate.now().toISOString(),
        syncStatus: 'pending'
      } as ExpenseRecord;

      const db = await getDB();
      const tx = db.transaction('expenses', 'readwrite');
      await tx.objectStore('expenses').put(expense);
      await tx.done;

      items = [expense, ...items];

      await syncManager.addToQueue({
        action: 'create',
        tripId: expense.id,
        userId,
        data: { ...expense, store: 'expenses' }
      });

      return expense;
    } catch (err) {
      console.error('❌ Failed to create expense:', err);
      void this.load(userId);
      throw err;
    }
  },

  async updateExpense(id: string, changes: Partial<ExpenseRecord>, userId: string) {
    items = items.map((e: ExpenseRecord) =>
      e.id === id ? { ...e, ...changes, updatedAt: SvelteDate.now().toISOString() } : e
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
        updatedAt: SvelteDate.now().toISOString(),
        syncStatus: 'pending'
      };
      await store.put(updated);
      await tx.done;

      await syncManager.addToQueue({
        action: 'update',
        tripId: id,
        userId,
        data: { ...updated, store: 'expenses' }
      });

      return updated;
    } catch (err) {
      console.error('❌ Failed to update expense:', err);
      void this.load(userId);
      throw err;
    }
  },

  async deleteExpense(id: string, userId: string) {
    const previous = items;
    items = items.filter((e: ExpenseRecord) => e.id !== id);

    try {
      const db = await getDB();
      const tx = db.transaction(['expenses', 'trash'], 'readwrite');
      const store = tx.objectStore('expenses');
      const trashStore = tx.objectStore('trash');

      const rec = await store.get(id);
      if (!rec) {
        await tx.done;
        await syncManager.addToQueue({
          action: 'delete',
          tripId: id,
          userId,
          data: { store: 'expenses' }
        });
        return;
      }

      if (rec.userId !== userId) {
        await tx.done;
        void this.load(userId);
        throw new Error('Unauthorized');
      }

      const now = SvelteDate.now();
      const expiresAt = SvelteDate.from(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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

      await this.load(userId);

      await syncManager.addToQueue({
        action: 'delete',
        tripId: id,
        userId,
        data: { store: 'expenses' }
      });
    } catch (err) {
      console.error('❌ Failed to delete expense:', err);
      items = previous;
      void this.load(userId);
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
    items = [];
  },

  async syncFromCloud(this: CreateExpensesAPI, userId: string) {
    _isLoading = true;
    try {
      if (!navigator.onLine) return;

      const lastSync = localStorage.getItem('last_sync_expenses');
      const sinceDate = lastSync
        ? SvelteDate.from(SvelteDate.from(lastSync).getTime() - 5 * 60 * 1000)
        : null;
      const url = sinceDate
        ? `/api/expenses?since=${encodeURIComponent(sinceDate.toISOString())}`
        : '/api/expenses';

      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch expenses');

      const cloudExpenses = (await response.json()) as ExpenseRecord[];

      if (Array.isArray(cloudExpenses) && cloudExpenses.length > 0) {
        const db = await getDB();
        const tx = db.transaction(['expenses', 'trash'], 'readwrite');
        const store = tx.objectStore('expenses');
        const trashStore = tx.objectStore('trash');

        const trashKeys = await trashStore.getAllKeys();
        const trashIds = new SvelteSet(trashKeys.map(String));

        for (const cloudExpense of cloudExpenses) {
          const maybeDeleted = (cloudExpense as ExpenseRecord & { deleted?: boolean }).deleted;
          if (maybeDeleted) {
            const local = await store.get(cloudExpense.id);
            if (local) await store.delete(cloudExpense.id);
            continue;
          }
          if (trashIds.has(cloudExpense.id)) continue;
          const local = await store.get(cloudExpense.id);
          if (
            !local ||
            SvelteDate.from(cloudExpense.updatedAt).getTime() >
              SvelteDate.from(local.updatedAt).getTime()
          ) {
            await store.put({
              ...cloudExpense,
              syncStatus: 'synced',
              lastSyncedAt: SvelteDate.now().toISOString()
            });
          }
        }
        await tx.done;
      }
      localStorage.setItem('last_sync_expenses', SvelteDate.now().toISOString());
    } catch (err) {
      console.error('❌ Failed to sync expenses from cloud:', err);
    } finally {
      if (_hydrationPromise) await _hydrationPromise;
      await this.load(userId);
      _isLoading = false;
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
      expense.updatedAt = SvelteDate.now().toISOString();
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

// Register the store with syncManager
syncManager.registerStore('expenses', {
  updateLocal: (item: unknown) => {
    const maybe = item as Partial<ExpenseRecord>;
    if (
      maybe &&
      typeof maybe.id === 'string' &&
      typeof maybe.amount === 'number' &&
      typeof maybe.category === 'string'
    ) {
      expenses.updateLocal(maybe as ExpenseRecord);
    }
  },
  syncDown: async () => {
    const curr = (auth as unknown as { user?: User | null }).user;
    if (curr?.id) await expenses.syncFromCloud(curr.id);
  }
});

// Compatibility export for legacy consumers that import `isLoading` from the module
export const isLoading = {
  subscribe(run: (v: boolean) => void) {
    // Emit current value synchronously
    run(_isLoading as boolean);
    // Subscribe reactively
    $effect(() => run(_isLoading as boolean));
    return () => undefined;
  }
};

// Draft expense helper (kept similar to legacy)
export const draftExpense = {
  save: (data: unknown) => localStorage.setItem('draft_expense', JSON.stringify(data)),
  load: () => {
    try {
      const stored = localStorage.getItem('draft_expense');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },
  clear: () => localStorage.removeItem('draft_expense')
};
