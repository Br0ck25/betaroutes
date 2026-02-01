import { PLAN_LIMITS } from '$lib/constants';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import type { MileageRecord, TrashRecord, TripRecord } from '$lib/db/types';
import { syncManager } from '$lib/sync/syncManager';
import type { User } from '$lib/types';
import { calculateFuelCost } from '$lib/utils/calculations';
import { SvelteDate, SvelteSet } from '$lib/utils/svelte-reactivity';
import type { IDBPDatabase } from 'idb';
import type { AppDB } from '$lib/db/indexedDB';
import { auth } from './auth';

// Reactive state
let items = $state<MileageRecord[]>([]);
const _isLoading = $state(false);

// Helper to resolve store name (backwards compat with misspelling)
function resolveMileageStoreName(db: unknown): 'mileage' | 'millage' {
  return typeof getMileageStoreName === 'function'
    ? getMileageStoreName(db as unknown as IDBPDatabase<AppDB>)
    : 'mileage';
}

// Minimal compatibility store helper for legacy consumers (subscribe-only)
function createCompatibilityStore<T>(
  getter: () => T,
  subscribeEffect: (set: (v: T) => void) => void | (() => void)
) {
  return {
    subscribe(run: (v: T) => void) {
      run(getter());
      const cleanup = subscribeEffect(run);
      return typeof cleanup === 'function' ? cleanup : () => {};
    }
  } as { subscribe: (run: (v: T) => void) => () => void };
}

export class MileageState {
  items = items;
  isLoading = _isLoading;

  // hydrate with server data (sets items synchronously, does DB sync in background)
  async hydrate(data: MileageRecord[], _userId?: string) {
    void _userId;
    items = (data ?? [])
      .map((d) => ({
        ...d,
        syncStatus: d.syncStatus ?? 'synced'
      }))
      .sort(
        (a, b) =>
          SvelteDate.from(b.date || b.createdAt).getTime() -
          SvelteDate.from(a.date || a.createdAt).getTime()
      );

    // Background DB sync (best-effort)
    try {
      const db = await getDB();
      const storeName = resolveMileageStoreName(db);
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of items) await store.put(item);
      await tx.done;
    } catch {
      /* ignore in test/dev environments */
    }
  }

  updateLocal(record: MileageRecord) {
    const cur = this.items;
    const idx = cur.findIndex((r) => r.id === record.id);
    if (idx !== -1) {
      const copy = [...cur];
      copy[idx] = { ...copy[idx], ...record };
      this.items = copy;
      return;
    }
    this.items = [record, ...cur].sort(
      (a, b) =>
        SvelteDate.from(b.date || b.createdAt).getTime() -
        SvelteDate.from(a.date || a.createdAt).getTime()
    );
  }

  async load(userId?: string) {
    this.isLoading = true;
    try {
      const db = await getDB();
      const storeName = resolveMileageStoreName(db);
      const tx = db.transaction([storeName, 'trash'], 'readonly');
      const store = tx.objectStore(storeName);
      const trashStore = tx.objectStore('trash');

      let itemsLoaded: MileageRecord[] = [];
      const maybeIndex = store as unknown as {
        index?: (name: string) => { getAll: (id?: string) => Promise<MileageRecord[]> };
        getAll?: () => Promise<MileageRecord[]>;
      };

      if (userId) {
        if (typeof maybeIndex.index === 'function') {
          const idx = maybeIndex.index('userId');
          itemsLoaded = await idx.getAll(userId);
        } else if (typeof maybeIndex.getAll === 'function') {
          const all = await maybeIndex.getAll();
          itemsLoaded = (all as MileageRecord[]).filter((m) => m.userId === userId);
        } else itemsLoaded = [];
      } else {
        if (typeof maybeIndex.getAll === 'function') itemsLoaded = await maybeIndex.getAll();
        else itemsLoaded = [];
      }

      const trashItems = await trashStore.getAll();
      const trashIds = new SvelteSet((trashItems as TrashRecord[]).map((t) => t.id));

      const active = itemsLoaded
        .filter((it) => !trashIds.has(it.id))
        .sort(
          (a, b) =>
            SvelteDate.from(b.date || b.createdAt).getTime() -
            SvelteDate.from(a.date || a.createdAt).getTime()
        );
      this.items = active;
      return active;
    } catch (err) {
      console.error('❌ Failed to load mileage:', err);
      this.items = [];
      return [];
    } finally {
      this.isLoading = false;
    }
  }

  async create(data: Partial<MileageRecord>, userId: string) {
    const currentUser = (auth as unknown as { user?: User | null }).user ?? null;
    const isFreeTier = !currentUser?.plan || currentUser?.plan === 'free';
    if (isFreeTier) {
      const db = await getDB();
      const tx = db.transaction('mileage', 'readonly');
      const index = tx.objectStore('mileage').index('userId');
      const allUserMileage = await index.getAll(userId);
      const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
      const windowMs = windowDays * 24 * 60 * 60 * 1000;
      const cutoff = SvelteDate.now().getTime() - windowMs;
      const recentCount = allUserMileage.filter(
        (m) => SvelteDate.from(m.date || m.createdAt).getTime() >= cutoff
      ).length;
      const allowed =
        PLAN_LIMITS.FREE.MAX_MILEAGE_PER_MONTH || PLAN_LIMITS.FREE.MAX_MILEAGE_IN_WINDOW || 10;
      if (recentCount >= allowed)
        throw new Error(
          `Free tier limit reached (${allowed} mileage logs per ${windowDays} days).`
        );
    }

    const nowIso = SvelteDate.now().toISOString();
    const base: Partial<MileageRecord> = {
      id: data.id || crypto.randomUUID(),
      userId,
      date: data.date || nowIso,
      startOdometer: (data.startOdometer as number) || 0,
      endOdometer: (data.endOdometer as number) || 0,
      miles:
        typeof data.miles === 'number'
          ? data.miles
          : Math.max(0, Number(data.endOdometer) - Number(data.startOdometer)),
      notes: data.notes || '',
      createdAt: data.createdAt || nowIso,
      updatedAt: data.updatedAt || nowIso,
      syncStatus: 'pending'
    };

    if (typeof data.mileageRate === 'number') base.mileageRate = data.mileageRate;
    if (typeof data.reimbursement === 'number') base.reimbursement = data.reimbursement;
    if (data.vehicle) base.vehicle = data.vehicle;

    const record: MileageRecord = base as MileageRecord;
    if (typeof record.reimbursement !== 'number') {
      let rate: number | undefined = record.mileageRate;
      if (rate == null) {
        try {
          const { userSettings } = await import('$lib/stores/userSettings');
          const settings = (
            userSettings as unknown as { subscribe?: (cb: (v: unknown) => void) => unknown }
          )?.subscribe
            ? (await import('$lib/stores/userSettings')).userSettings
            : null;
          const snapshot = settings ? (typeof settings === 'object' ? settings : null) : null;
          rate =
            snapshot && typeof (snapshot as { mileageRate?: unknown }).mileageRate === 'number'
              ? (snapshot as unknown as { mileageRate?: number }).mileageRate
              : undefined;
        } catch {
          /* ignore */
        }
      }
      if (typeof rate === 'number' && typeof record.miles === 'number')
        record.reimbursement = Number((record.miles * rate).toFixed(2));
    }

    this.items = [record, ...this.items];
    try {
      const db = await getDB();
      const mileageStoreName = resolveMileageStoreName(db);
      const tx = db.transaction(mileageStoreName, 'readwrite');
      await tx.objectStore(mileageStoreName).put(record);
      await tx.done;
      setTimeout(() => {
        void syncManager.addToQueue({
          action: 'create',
          tripId: record.id,
          data: { ...record, store: 'mileage' },
          userId
        });
      }, 0);
      return record;
    } catch (err) {
      console.error('❌ Failed to create mileage record:', err);
      void this.load(userId);
      throw err;
    }
  }

  async updateMileage(id: string, changes: Partial<MileageRecord>, userId: string) {
    this.items = this.items.map((r) =>
      r.id === id ? { ...r, ...changes, updatedAt: SvelteDate.now().toISOString() } : r
    );
    try {
      const db = await getDB();
      const mileageStoreName = resolveMileageStoreName(db);
      const tx = db.transaction(mileageStoreName, 'readwrite');
      const store = tx.objectStore(mileageStoreName);
      const existing = await store.get(id);
      if (!existing) throw new Error('Mileage record not found');
      if (existing.userId !== userId) throw new Error('Unauthorized');
      const updated: MileageRecord = {
        ...existing,
        ...changes,
        id,
        userId,
        updatedAt: SvelteDate.now().toISOString(),
        syncStatus: 'pending'
      };

      const odometerUpdated =
        Object.prototype.hasOwnProperty.call(changes, 'startOdometer') ||
        Object.prototype.hasOwnProperty.call(changes, 'endOdometer');
      const milesExplicit = Object.prototype.hasOwnProperty.call(changes, 'miles');
      if (
        odometerUpdated &&
        !milesExplicit &&
        typeof updated.startOdometer === 'number' &&
        typeof updated.endOdometer === 'number'
      ) {
        updated.miles = Math.max(0, Number(updated.endOdometer) - Number(updated.startOdometer));
      }

      const milesChanged = Object.prototype.hasOwnProperty.call(changes, 'miles');
      const rateChanged = Object.prototype.hasOwnProperty.call(changes, 'mileageRate');
      const reimbursementExplicit = Object.prototype.hasOwnProperty.call(changes, 'reimbursement');
      if (
        !reimbursementExplicit &&
        (milesChanged || rateChanged) &&
        typeof updated.miles === 'number'
      ) {
        let rate = typeof updated.mileageRate === 'number' ? updated.mileageRate : undefined;
        if (rate == null) {
          try {
            const { userSettings } = await import('$lib/stores/userSettings');
            const settings = (
              userSettings as unknown as { subscribe?: (cb: (v: unknown) => void) => unknown }
            )?.subscribe
              ? (await import('$lib/stores/userSettings')).userSettings
              : null;
            const snapshot = settings ? (typeof settings === 'object' ? settings : null) : null;
            rate =
              snapshot && typeof (snapshot as { mileageRate?: unknown }).mileageRate === 'number'
                ? (snapshot as unknown as { mileageRate?: number }).mileageRate
                : undefined;
          } catch {
            /* ignore */
          }
        }
        if (typeof rate === 'number')
          updated.reimbursement = Number((updated.miles * rate).toFixed(2));
      }

      await store.put(updated);
      await tx.done;

      try {
        const tripsTx = db.transaction('trips', 'readwrite');
        const tripStore = tripsTx.objectStore('trips');
        const trip = (await tripStore.get(id)) as unknown as {
          userId?: string;
          mpg?: number;
          gasPrice?: number;
          [k: string]: unknown;
        } | null;
        if (trip && trip.userId === userId) {
          const nowIso = SvelteDate.now().toISOString();
          const newMiles = updated.miles || 0;
          const mpg = typeof trip.mpg === 'number' ? (trip.mpg as number) : 25;
          const gasPrice = typeof trip.gasPrice === 'number' ? (trip.gasPrice as number) : 3.5;
          const newFuelCost = calculateFuelCost(newMiles, mpg, gasPrice);
          const patched = {
            ...trip,
            totalMiles: newMiles,
            fuelCost: newFuelCost,
            updatedAt: nowIso,
            syncStatus: 'pending'
          } as unknown as Record<string, unknown>;
          await tripStore.put(patched as unknown as TripRecord);
          try {
            const { trips } = await import('$lib/stores/trips');
            trips.updateLocal({
              id,
              totalMiles: newMiles,
              fuelCost: newFuelCost,
              updatedAt: nowIso
            } as unknown as TripRecord);
          } catch {
            /* ignore */
          }
        }
        await tripsTx.done;
      } catch {
        /* ignore */
      }

      setTimeout(() => {
        void syncManager.addToQueue({
          action: 'update',
          tripId: id,
          data: { ...updated, store: 'mileage' },
          userId
        });
      }, 0);

      return updated;
    } catch (err) {
      console.error('❌ Failed to update mileage:', err);
      void this.load(userId);
      throw err;
    }
  }

  async deleteMileage(id: string, userId: string) {
    const previous = this.items;
    this.items = this.items.filter((r) => r.id !== id);
    try {
      const db = await getDB();
      const mileageStoreName = resolveMileageStoreName(db);
      const tx = db.transaction([mileageStoreName, 'trash'], 'readwrite');
      const mileageStore = tx.objectStore(mileageStoreName);
      const trashStore = tx.objectStore('trash');

      const rec = await mileageStore.get(id);
      if (!rec) {
        await tx.done;
        setTimeout(() => {
          void syncManager.addToQueue({
            action: 'delete',
            tripId: id,
            data: { store: 'mileage' },
            userId
          });
        }, 0);
        return;
      }

      if (rec.userId !== userId) {
        await tx.done;
        throw new Error('Unauthorized');
      }

      const now = SvelteDate.now();
      const expiresAt = SvelteDate.from(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const trashItem: TrashRecord = {
        id: `mileage:${rec.id}`,
        tripId: rec.tripId || undefined,
        type: 'mileage',
        recordType: 'mileage',
        data: rec,
        deletedAt: now.toISOString(),
        deletedBy: userId,
        expiresAt: expiresAt.toISOString(),
        userId: userId,
        originalKey: `mileage:${userId}:${id}`,
        syncStatus: 'pending',
        miles: rec.miles,
        vehicle: rec.vehicle,
        date: rec.date,
        backups: { mileage: { ...rec } }
      };

      await trashStore.put(trashItem as TrashRecord);
      await mileageStore.delete(id);

      try {
        const tripsTx = db.transaction('trips', 'readwrite');
        const tripStore = tripsTx.objectStore('trips');
        const tripIdToUpdate =
          typeof rec.tripId === 'string' && rec.tripId ? (rec.tripId as string) : id;
        if (tripIdToUpdate) {
          const trip = await tripStore.get(tripIdToUpdate);
          if (trip && trip.userId === userId) {
            const nowIso = SvelteDate.now().toISOString();
            const patched = {
              ...trip,
              totalMiles: 0,
              fuelCost: 0,
              updatedAt: nowIso,
              syncStatus: 'pending'
            } as unknown as Record<string, unknown>;
            await tripStore.put(patched as unknown as import('$lib/db/types').TripRecord);
            try {
              const { trips } = await import('$lib/stores/trips');
              trips.updateLocal({
                id: tripIdToUpdate,
                totalMiles: 0,
                fuelCost: 0,
                updatedAt: nowIso
              } as unknown as import('$lib/db/types').TripRecord);
            } catch {
              /* ignore */
            }

            await syncManager.addToQueue({
              action: 'update',
              tripId: tripIdToUpdate,
              data: { ...patched, store: 'trips', skipEnrichment: true },
              userId
            });
          }
        }
      } catch {
        /* ignore */
      }

      setTimeout(() => {
        void syncManager.addToQueue({
          action: 'delete',
          tripId: id,
          data: { store: 'mileage' },
          userId
        });
      }, 0);
      return;
    } catch (err) {
      console.error('❌ Failed to delete mileage record:', err);
      this.items = previous;
      throw err;
    }
  }

  async get(id: string, userId: string) {
    try {
      const db = await getDB();
      const tx = db.transaction('mileage', 'readonly');
      const item = await tx.objectStore('mileage').get(id);
      if (!item || item.userId !== userId) return null;
      return item;
    } catch {
      return null;
    }
  }

  async findByTripId(tripId: string, userId: string) {
    try {
      const db = await getDB();
      const tx = db.transaction('mileage', 'readonly');
      const index = tx.objectStore('mileage').index('userId');
      const all = (await index.getAll(userId)) as MileageRecord[];
      const found = all.find((m) => m.tripId === tripId) ?? null;
      return found as MileageRecord | null;
    } catch {
      return null;
    }
  }

  clear() {
    this.items = [];
  }

  set(records: MileageRecord[]) {
    this.items = (records ?? []).sort(
      (a, b) =>
        SvelteDate.from(b.date || b.createdAt).getTime() -
        SvelteDate.from(a.date || a.createdAt).getTime()
    );
  }

  async syncFromCloud(userId: string) {
    this.isLoading = true;
    try {
      if (!navigator.onLine) return;
      const lastSync = localStorage.getItem('last_sync_mileage');
      const sinceDate = lastSync
        ? SvelteDate.from(SvelteDate.from(lastSync).getTime() - 5 * 60 * 1000)
        : null;
      const url = sinceDate
        ? `/api/mileage?since=${encodeURIComponent(sinceDate.toISOString())}`
        : '/api/mileage';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch mileage');
      const cloudRaw = await response.json().catch(() => []);
      const cloud = Array.isArray(cloudRaw) ? (cloudRaw as Array<Record<string, unknown>>) : [];
      if (cloud.length > 0) {
        const db = await getDB();
        const tx = db.transaction(['mileage', 'trash'], 'readwrite');
        const store = tx.objectStore('mileage');
        const trashStore = tx.objectStore('trash');
        const trashItems = await trashStore.getAll();
        const trashIds = new SvelteSet(
          (trashItems as TrashRecord[]).map((t) => t.id || `mileage:${t.id}`)
        );
        for (const recRaw of cloud) {
          const rec = recRaw as Record<string, unknown>;
          const deleted = typeof rec['deleted'] === 'boolean' ? (rec['deleted'] as boolean) : false;
          const recId = typeof rec['id'] === 'string' ? (rec['id'] as string) : undefined;
          if (deleted) {
            if (recId) {
              const local = await store.get(recId);
              if (local) await store.delete(recId);
            }
            continue;
          }
          if (!recId) continue;
          if (trashIds.has(recId) || trashIds.has(`mileage:${recId}`)) continue;
          const local = await store.get(recId);
          const recUpdatedAt =
            typeof rec['updatedAt'] === 'string' ? (rec['updatedAt'] as string) : undefined;
          const localUpdatedAt =
            local && typeof local.updatedAt === 'string' ? local.updatedAt : undefined;
          const recTs = recUpdatedAt ? SvelteDate.from(recUpdatedAt).getTime() : 0;
          const localTs = localUpdatedAt ? SvelteDate.from(localUpdatedAt).getTime() : 0;
          if (!local || (recUpdatedAt && recTs > localTs)) {
            const toPut = {
              ...rec,
              syncStatus: 'synced',
              lastSyncedAt: SvelteDate.now().toISOString()
            } as unknown as MileageRecord;
            await store.put(toPut);
          }
        }
        await tx.done;
      }
      localStorage.setItem('last_sync_mileage', SvelteDate.now().toISOString());
    } catch (err) {
      console.error('❌ Failed to sync mileage from cloud:', err);
    } finally {
      await this.load(userId);
      this.isLoading = false;
    }
  }

  async migrateOfflineMileage(tempUserId: string, realUserId: string) {
    if (!tempUserId || !realUserId || tempUserId === realUserId) return;
    const db = await getDB();
    const tx = db.transaction('mileage', 'readwrite');
    const store = tx.objectStore('mileage');
    const index = store.index('userId');
    const offline = await index.getAll(tempUserId);
    for (const r of offline) {
      r.userId = realUserId;
      r.syncStatus = 'pending';
      r.updatedAt = SvelteDate.now().toISOString();
      await store.put(r);
      await syncManager.addToQueue({
        action: 'create',
        tripId: r.id,
        data: { ...r, store: 'mileage' }
      });
    }
    await tx.done;
    await this.load(realUserId);
  }
}

export const mileage = new MileageState() as MileageState & {
  subscribe: (run: (v: MileageRecord[]) => void) => () => void;
};

mileage.subscribe = (run: (v: MileageRecord[]) => void) => {
  run(mileage.items);
  $effect(() => run(mileage.items));
  return () => {};
};

export const isLoading = createCompatibilityStore<boolean>(
  () => mileage.isLoading,
  (set) => {
    $effect(() => set(mileage.isLoading));
  }
);

function createDraftStore() {
  let internal = $state<Record<string, unknown> | null>(
    (() => {
      try {
        const stored = localStorage.getItem('draft_mileage');
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    })()
  );
  return {
    subscribe(run: (v: Record<string, unknown> | null) => void) {
      run(internal);
      $effect(() => run(internal));
      return () => {};
    },
    save: (data: unknown) => {
      localStorage.setItem('draft_mileage', JSON.stringify(data));
      internal = data as Record<string, unknown> | null;
    },
    load: () => {
      try {
        const stored = localStorage.getItem('draft_mileage');
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    },
    clear: () => {
      localStorage.removeItem('draft_mileage');
      internal = null;
    }
  } as const;
}

export const draftMileage = createDraftStore();

syncManager.registerStore('mileage', {
  updateLocal: (item: unknown) => {
    if (item && typeof (item as Record<string, unknown>)['miles'] === 'number') {
      mileage.updateLocal(item as MileageRecord);
    }
  },
  syncDown: async () => {
    const u = (auth as unknown as { user?: User | null }).user;
    if (u?.id) await mileage.syncFromCloud(u.id);
  }
});
