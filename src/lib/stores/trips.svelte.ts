import { PLAN_LIMITS } from '$lib/constants';
import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import type { MileageRecord, TrashRecord, TripRecord } from '$lib/db/types';
import { syncManager } from '$lib/sync/syncManager';
import type { User } from '$lib/types';
import { csrfFetch } from '$lib/utils/csrf';
import { storage } from '$lib/utils/storage';
import { SvelteDate, SvelteSet } from '$lib/utils/svelte-reactivity';
import { auth } from './auth';
import { userSettings } from './userSettings';

// Snapshot of userSettings kept in sync for synchronous reads inside methods
let _userSettings = $state<Record<string, unknown> | null>(null);
try {
  $effect(() => {
    const unsub = userSettings.subscribe((v) => (_userSettings = v as Record<string, unknown>));
    return unsub;
  });
} catch (_err) {
  // In some test environments $effect may not be available during module eval
  // Fall back to a direct (non-reactive) subscribe to populate snapshot for tests
  const sub = (userSettings as unknown as { subscribe?: (cb: (v: unknown) => void) => unknown })
    .subscribe;
  if (typeof sub === 'function') {
    try {
      const unsub = sub((v: unknown) => (_userSettings = v as Record<string, unknown>));
      if (typeof unsub === 'function') (unsub as () => void)();
    } catch {
      // best-effort only
    }
  }
}

// Minimal compatibility store helper for legacy consumers (subscribe-only)
function createCompatibilityStore<T>(
  getter: () => T,
  subscribeEffect: (set: (v: T) => void) => void | (() => void)
) {
  return {
    subscribe(run: (v: T) => void) {
      // Emit initial value synchronously
      run(getter());
      const cleanup = subscribeEffect(run);
      return typeof cleanup === 'function' ? cleanup : () => {};
    }
  } as { subscribe: (run: (v: T) => void) => () => void };
}

export class TripsState {
  trips = $state<TripRecord[]>([]);
  isLoading = $state(false);

  // Prevent re-entrant syncFromCloud
  private _isSyncingFromCloud = false;

  subscribe(run: (v: TripRecord[]) => void) {
    run(this.trips);
    $effect(() => run(this.trips));
    return () => {};
  }

  updateLocal(trip: TripRecord) {
    console.debug('[DEV_DEBUG] trips.updateLocal for', trip.id);
    const current = this.trips;
    const index = current.findIndex((t) => t.id === trip.id);
    if (index !== -1) {
      const newItems = [...current];
      newItems[index] = { ...newItems[index], ...trip };
      this.trips = newItems;
      return;
    }
    this.trips = [trip, ...current];
  }

  async load(userId?: string) {
    this.isLoading = true;
    try {
      const db = await getDB();
      const tx = db.transaction('trips', 'readonly');
      const store = tx.objectStore('trips');
      let trips: TripRecord[];
      if (userId) {
        const index = store.index('userId');
        trips = await index.getAll(userId);
      } else {
        trips = await store.getAll();
      }
      trips.sort((a, b) => {
        const dateA = SvelteDate.from(a.date || a.createdAt).getTime();
        const dateB = SvelteDate.from(b.date || b.createdAt).getTime();
        return dateB - dateA;
      });

      const dbRW = db.transaction('trips', 'readwrite');
      const storeRW = dbRW.objectStore('trips');
      for (const t of trips) {
        if (t.totalMiles == null && (t as TripRecord)['totalMileage'] != null) {
          (t as TripRecord).totalMiles = Number((t as TripRecord)['totalMileage']) || 0;
          (t as TripRecord).syncStatus = 'pending';
          (t as TripRecord).updatedAt = SvelteDate.now().toISOString();
          (t as TripRecord)['lastModified'] = SvelteDate.now().toISOString();
          await storeRW.put(t);
        }
      }
      await dbRW.done;

      this.trips = trips;
      console.debug('[DEV_DEBUG] trips.load: set store with', trips.length, 'trips');
      return trips;
    } catch (err) {
      console.error('❌ Failed to load trips:', err);
      this.trips = [];
      return [];
    } finally {
      this.isLoading = false;
    }
  }

  async create(tripData: Partial<TripRecord>, userId: string) {
    try {
      const currentUser = auth.user as User | null;
      const isFreeTier = !currentUser?.plan || currentUser.plan === 'free';
      if (isFreeTier) {
        const db = await getDB();
        const tx = db.transaction('trips', 'readonly');
        const index = tx.objectStore('trips').index('userId');
        const allUserTrips = await index.getAll(userId);
        const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
        const windowMs = windowDays * 24 * 60 * 60 * 1000;
        const cutoffMs = SvelteDate.now().getTime() - windowMs;
        const recentCount = allUserTrips.filter((t) => {
          const dMs = SvelteDate.from(t.date || t.createdAt).getTime();
          return dMs >= cutoffMs;
        }).length;
        const allowed =
          PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10;
        if (recentCount >= allowed) {
          throw new Error(`Free tier limit reached (${allowed} trips per ${windowDays} days).`);
        }
      }

      const now = SvelteDate.now().toISOString();
      const td = tripData as Partial<TripRecord> & {
        maintenanceItems?: unknown[];
        suppliesItems?: unknown[];
        stops?: unknown[];
        destinations?: unknown[];
        roundTripMiles?: number;
        roundTripTime?: number;
      };

      const normalizedStops: import('$lib/db/types').StopRecord[] = (td.stops ?? []).map(
        (s: unknown, i) => {
          const st = s as Record<string, unknown>;
          return {
            id: String(st['id'] ?? crypto.randomUUID()),
            address: String(st['address'] ?? ''),
            earnings: Number(st['earnings'] ?? 0) || 0,
            notes: typeof st['notes'] === 'string' ? (st['notes'] as string) : '',
            order: typeof st['order'] === 'number' ? (st['order'] as number) : i
          };
        }
      );

      const trip: TripRecord = {
        id: String(td.id ?? crypto.randomUUID()),
        userId,
        date: String(td.date ?? now),
        payDate: String(td.payDate ?? ''),
        startTime: String(td.startTime ?? ''),
        endTime: String(td.endTime ?? ''),
        hoursWorked: Number(td.hoursWorked ?? 0) || 0,
        startAddress: String(td.startAddress ?? ''),
        endAddress: String(td.endAddress ?? ''),
        stops: normalizedStops,
        totalMiles: Number(td.totalMiles ?? 0) || 0,
        totalMileage: Number(td.totalMileage ?? td.totalMiles ?? 0) || 0,
        mpg: Number(td.mpg ?? 0) || 0,
        gasPrice: Number(td.gasPrice ?? 0) || 0,
        fuelCost: Number(td.fuelCost ?? 0) || 0,
        estimatedTime: Number(td.estimatedTime ?? 0) || 0,
        roundTripMiles: Number(td.roundTripMiles ?? 0) || 0,
        roundTripTime: Number(td.roundTripTime ?? 0) || 0,
        maintenanceItems: Array.isArray(td.maintenanceItems)
          ? td.maintenanceItems.map((it: unknown) => {
              const r = it as Record<string, unknown>;
              return {
                id: String(r['id'] ?? crypto.randomUUID()),
                type: String(r['type'] ?? ''),
                item: String(r['item'] ?? ''),
                cost: Number(r['cost'] ?? 0) || 0,
                taxDeductible: Boolean(r['taxDeductible'] ?? false)
              };
            })
          : [],
        suppliesItems: Array.isArray(td.suppliesItems)
          ? td.suppliesItems.map((it: unknown) => {
              const r = it as Record<string, unknown>;
              return {
                id: String(r['id'] ?? crypto.randomUUID()),
                type: String(r['type'] ?? ''),
                item: String(r['item'] ?? ''),
                cost: Number(r['cost'] ?? 0) || 0,
                taxDeductible: Boolean(r['taxDeductible'] ?? false)
              };
            })
          : [],
        notes: String(td.notes ?? ''),
        taxDeductible: Boolean(td['taxDeductible'] ?? false),
        destinations: Array.isArray(td.stops)
          ? (td.stops as unknown[]).map((s: unknown) => {
              const r = s as Record<string, unknown>;
              return {
                address: String(r['address'] ?? ''),
                earnings: Number(r['earnings'] ?? 0) || 0,
                notes: String(r['notes'] ?? '')
              };
            })
          : [],
        createdAt: String(td.createdAt ?? now),
        updatedAt: String(td.updatedAt ?? now),
        lastModified: now,
        syncStatus: 'pending'
      } as TripRecord;

      const db = await getDB();
      const tx = db.transaction('trips', 'readwrite');
      await tx.objectStore('trips').put(trip);
      await tx.done;

      const currentTrips = this.trips;
      const exists = currentTrips.find((t) => t.id === trip.id);
      if (exists) this.trips = currentTrips.map((t) => (t.id === trip.id ? trip : t));
      else this.trips = [trip, ...currentTrips];

      try {
        await syncManager.addToQueue({
          action: 'create',
          tripId: trip.id,
          data: { ...trip, store: 'trips' },
          userId
        });
      } catch (err) {
        console.warn('Failed to enqueue trip for sync:', err);
      }

      return trip;
    } catch (err) {
      console.error('❌ Failed to create trip:', err);
      throw err;
    }
  }

  async updateTrip(id: string, changes: Partial<TripRecord>, userId: string) {
    try {
      const db = await getDB();
      const tx = db.transaction('trips', 'readwrite');
      const store = tx.objectStore('trips');
      const existing = await store.get(id);
      if (!existing) throw new Error('Trip not found');
      if (existing.userId !== userId) throw new Error('Unauthorized');
      const now = SvelteDate.now().toISOString();
      const normalizedStops = (changes.stops || existing.stops || []).map(
        (s: unknown, i: number) => {
          const st = s as Record<string, unknown>;
          return {
            id: String(st['id'] ?? crypto.randomUUID()),
            address: String(st['address'] ?? ''),
            earnings: Number(st['earnings'] ?? 0) || 0,
            notes: (st['notes'] as string) || '',
            order: typeof st['order'] === 'number' ? (st['order'] as number) : i,
            distanceFromPrev: Number(st['distanceFromPrev'] ?? 0) || 0,
            timeFromPrev: Number(st['timeFromPrev'] ?? 0) || 0
          };
        }
      );
      const updated: TripRecord = {
        ...existing,
        ...changes,
        stops: normalizedStops,
        id,
        userId,
        updatedAt: now,
        lastModified: now,
        syncStatus: 'pending'
      };
      await store.put(updated);
      await tx.done;
      this.trips = this.trips.map((t) => (t.id === id ? updated : t));
      await syncManager.addToQueue({ action: 'update', tripId: id, data: updated, userId });

      try {
        if (Object.prototype.hasOwnProperty.call(changes, 'totalMiles')) {
          const { mileage } = await import('./mileage');
          let existingMileage = await mileage.get(id, userId);
          if (!existingMileage) {
            if (typeof mileage.findByTripId === 'function') {
              existingMileage = await mileage.findByTripId(id, userId);
            } else {
              const db = await getDB();
              const tx = db.transaction('mileage', 'readonly');
              const index = tx.objectStore('mileage').index('userId');
              const all = (await index.getAll(userId)) as MileageRecord[];
              existingMileage = (all.find((m) => m.tripId === id) as MileageRecord | null) ?? null;
            }
          }
          if (existingMileage) {
            await mileage.updateMileage(
              String(existingMileage.id),
              { miles: Number(changes.totalMiles ?? 0) },
              userId
            );
          } else if (Number(changes.totalMiles ?? 0) > 0) {
            const mileagePayload: Partial<MileageRecord> = {
              id,
              tripId: id,
              miles: Number(changes.totalMiles ?? 0),
              createdAt: updated.createdAt,
              updatedAt: updated.updatedAt
            };

            const mRate = (_userSettings as unknown as { mileageRate?: number })?.mileageRate;
            if (typeof mRate === 'number') mileagePayload.mileageRate = mRate;
            const veh = (
              _userSettings as unknown as { vehicles?: Array<{ id?: string; name?: string }> }
            )?.vehicles?.[0];
            if (veh?.id) mileagePayload.vehicle = veh.id;
            else if (veh?.name) mileagePayload.vehicle = veh.name;

            await mileage.create(mileagePayload, userId);
          }
        }
      } catch (err) {
        console.warn('Failed to mirror trip mileage to local mileage store:', err);
      }
      return updated;
    } catch (err) {
      console.error('❌ Failed to update trip:', err);
      throw err;
    }
  }

  async deleteTrip(id: string, userId: string) {
    let previousTrips: TripRecord[] = [];
    previousTrips = this.trips;
    this.trips = this.trips.filter((t) => t.id !== id);

    try {
      const db = await getDB();
      const tripsTx = db.transaction('trips', 'readonly');
      const trip = await tripsTx.objectStore('trips').get(id);
      if (!trip) throw new Error('Trip not found');
      if (trip.userId !== userId) throw new Error('Unauthorized');

      const nowSD = SvelteDate.now();
      const expiresAtSD = new SvelteDate(nowSD.getTime() + 30 * 24 * 60 * 60 * 1000);

      const trashItem: TrashRecord = {
        ...(trip as Partial<TripRecord>),
        id: `trip:${id}`,
        originalId: id,
        userId: trip.userId,
        deletedAt: nowSD.toISOString(),
        deletedBy: userId,
        expiresAt: expiresAtSD.toISOString(),
        originalKey: `trip:${userId}:${id}`,
        syncStatus: 'pending',
        recordType: 'trip',
        backups: { trip: { ...trip } }
      };

      const mileageStoreName = getMileageStoreName(db);
      const mileageTx = db.transaction(mileageStoreName, 'readwrite');
      const activeMileage = await mileageTx.objectStore(mileageStoreName).get(id);
      let mileageTrashItem: TrashRecord | null = null;
      if (activeMileage) {
        (trashItem as Record<string, unknown>)['backups'] = {
          ...((trashItem as Record<string, unknown>)['backups'] || {}),
          mileage: { ...activeMileage }
        };
        (trashItem as Record<string, unknown>)['miles'] = activeMileage.miles;
        (trashItem as Record<string, unknown>)['vehicle'] = activeMileage.vehicle;

        mileageTrashItem = {
          ...(activeMileage as Partial<MileageRecord>),
          id: `mileage:${id}`,
          originalId: id,
          userId: activeMileage.userId,
          deletedAt: nowSD.toISOString(),
          deletedBy: userId,
          expiresAt: expiresAtSD.toISOString(),
          originalKey: `mileage:${userId}:${id}`,
          syncStatus: 'pending',
          recordType: 'mileage',
          tripId: id,
          backups: { mileage: { ...activeMileage } }
        };
        await mileageTx.objectStore(mileageStoreName).delete(id);
      }
      await mileageTx.done;

      const trashTx = db.transaction('trash', 'readwrite');
      await trashTx.objectStore('trash').put(trashItem);
      if (mileageTrashItem) await trashTx.objectStore('trash').put(mileageTrashItem);
      await trashTx.done;

      const delTx = db.transaction('trips', 'readwrite');
      await delTx.objectStore('trips').delete(id);
      await delTx.done;

      // Resolve authenticated user dynamically to avoid hard dependency on the auth module shape in tests
      let currentUser: User | null = null;
      try {
        const maybe = (await import('$lib/stores/auth')) as unknown;
        const maybeAuth = maybe as { auth?: { user?: unknown }; user?: unknown };
        if (maybeAuth.auth && maybeAuth.auth.user !== undefined) {
          currentUser = maybeAuth.auth.user as User | null;
        } else if (maybeAuth.user !== undefined) {
          const maybeUser = maybeAuth.user;
          if (typeof (maybeUser as Record<string, unknown>).subscribe === 'function') {
            const unsub = (
              maybeUser as { subscribe: (cb: (v: User | null) => unknown) => unknown }
            ).subscribe((v: User | null) => (currentUser = v));
            if (typeof unsub === 'function') (unsub as () => void)();
          } else {
            currentUser = maybeUser as User | null;
          }
        }
      } catch {
        // ignore - best-effort only
      }

      if (
        (currentUser && currentUser.id && currentUser.id === trip.userId) ||
        userId === trip.userId
      ) {
        const enqueueUserId =
          currentUser && currentUser.id && currentUser.id === trip.userId ? currentUser.id : userId;
        await syncManager.addToQueue({ action: 'delete', tripId: id, userId: enqueueUserId });
      }
    } catch (err) {
      console.error('❌ Failed to delete trip:', err);
      this.trips = previousTrips;
      throw err;
    }
  }

  async get(id: string, userId: string) {
    try {
      const db = await getDB();
      const tx = db.transaction('trips', 'readonly');
      const trip = await tx.objectStore('trips').get(id);
      if (!trip || trip.userId !== userId) return null;
      return trip;
    } catch (err) {
      console.error('❌ Failed to get trip:', err);
      return null;
    }
  }

  clear() {
    this.trips = [];
  }

  async syncFromCloud(userId: string) {
    if (this._isSyncingFromCloud) {
      console.debug('[DEV_DEBUG] syncFromCloud skipped - already running');
      return;
    }

    this._isSyncingFromCloud = true;
    this.isLoading = true;
    console.debug(
      '[DEV_DEBUG] syncFromCloud start for user',
      userId,
      'lastSync',
      storage.getLastSync()
    );

    try {
      if (!navigator.onLine) return;
      const lastSync = storage.getLastSync();
      let url = '/api/trips';
      if (lastSync) {
        try {
          const adjustedSD = SvelteDate.from(lastSync);
          let adjustedMs = adjustedSD.getTime() - 5 * 60 * 1000;
          const nowSD = SvelteDate.now();
          if (adjustedMs > nowSD.getTime()) {
            adjustedMs = nowSD.getTime() - 5 * 60 * 1000;
          }
          url = `/api/trips?since=${encodeURIComponent(new SvelteDate(adjustedMs).toISOString())}`;
        } catch {
          url = `/api/trips?since=${encodeURIComponent(lastSync)}`;
        }
      }
      console.log(`☁️ Syncing trips... ${lastSync ? `(Delta since ${lastSync})` : '(Full)'}`);
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch trips');
      const cloudTrips: unknown[] = (await response.json()) as unknown[];
      if (cloudTrips.length === 0) {
        console.log('☁️ No new trip changes.');
        storage.setLastSync(SvelteDate.now().toISOString());
        return;
      }
      const db = await getDB();
      const trashTx = db.transaction('trash', 'readonly');
      const trashStore = trashTx.objectStore('trash');
      const trashItems = await trashStore.getAll();
      const trashIds = new SvelteSet(trashItems.map((t: { id: string }) => t.id));
      const tx = db.transaction('trips', 'readwrite');
      const store = tx.objectStore('trips');
      let updateCount = 0;
      let deleteCount = 0;
      for (const cloudTripRaw of cloudTrips) {
        const cloudTrip = cloudTripRaw as unknown as {
          id?: string;
          updatedAt?: string;
          deleted?: boolean;
        };
        if (!cloudTrip.id) continue;
        if (trashIds.has(cloudTrip.id) || trashIds.has(`trip:${cloudTrip.id}`)) continue;
        const local = await store.get(cloudTrip.id);
        if (
          !local ||
          SvelteDate.from(cloudTrip.updatedAt || '').getTime() >
            SvelteDate.from(local.updatedAt || '').getTime()
        ) {
          if (cloudTrip.deleted) {
            await store.delete(cloudTrip.id);
            deleteCount++;
          } else {
            await store.put({
              ...(cloudTrip as object),
              syncStatus: 'synced',
              lastSyncedAt: SvelteDate.now().toISOString()
            });
            updateCount++;
          }
        }
      }
      await tx.done;
      storage.setLastSync(SvelteDate.now().toISOString());
      console.log(`✅ Synced trips. Updated: ${updateCount}, Deleted: ${deleteCount}.`);

      await this.load(userId);
    } catch (err) {
      console.error('❌ Failed to sync trips from cloud:', err);
    } finally {
      this._isSyncingFromCloud = false;
      this.isLoading = false;
      console.debug('[DEV_DEBUG] syncFromCloud complete for user', userId);
    }
  }

  async syncPendingToCloud(userId: string) {
    try {
      if (!navigator.onLine) return { synced: 0, failed: 0 };
      console.log('⬆️ Syncing pending local changes...');
      const db = await getDB();
      const tx = db.transaction('trips', 'readonly');
      const index = tx.objectStore('trips').index('userId');
      const allTrips = await index.getAll(userId);
      await tx.done;
      const pendingTrips = allTrips.filter((t) => t.syncStatus === 'pending');
      if (pendingTrips.length === 0) return { synced: 0, failed: 0 };
      console.log(`📤 Uploading ${pendingTrips.length} pending trip(s)...`);
      let synced = 0;
      let failed = 0;
      for (const trip of pendingTrips) {
        try {
          const method = trip.createdAt !== trip.updatedAt ? 'PUT' : 'POST';
          const response = await csrfFetch('/api/trips', { method, credentials: 'include' });
          if (response.ok) {
            const updateTx = db.transaction('trips', 'readwrite');
            const updatedTrip = { ...trip, syncStatus: 'synced' as const };
            await updateTx.objectStore('trips').put(updatedTrip);
            await updateTx.done;
            synced++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error('Error syncing trip:', trip.id, err);
          failed++;
        }
      }
      return { synced, failed };
    } catch (err) {
      console.error('❌ Failed to sync pending changes:', err);
      return { synced: 0, failed: 0 };
    }
  }

  async migrateOfflineTrips(tempUserId: string, realUserId: string) {
    if (!tempUserId || !realUserId || tempUserId === realUserId) return;
    const db = await getDB();
    const tx = db.transaction('trips', 'readwrite');
    const store = tx.objectStore('trips');
    const index = store.index('userId');
    const offlineTrips = await index.getAll(tempUserId);
    for (const trip of offlineTrips) {
      trip.userId = realUserId;
      trip.syncStatus = 'pending';
      trip.updatedAt = SvelteDate.now().toISOString();
      await store.put(trip);
      await syncManager.addToQueue({
        action: 'create',
        tripId: trip.id,
        data: trip,
        userId: realUserId
      });
    }
    await tx.done;
    await this.load(realUserId);
  }

  getSnapshot() {
    return { trips: this.trips, isLoading: this.isLoading };
  }
}

export const trips = new TripsState() as TripsState & {
  subscribe: (run: (v: TripRecord[]) => void) => () => void;
};

trips.subscribe = (run: (v: TripRecord[]) => void) => {
  run(trips.trips);
  $effect(() => run(trips.trips));
  return () => {};
};

export const isLoading = createCompatibilityStore<boolean>(
  () => trips.isLoading,
  (set) => {
    $effect(() => set(trips.isLoading));
  }
);

// Draft trip compatibility store
function createDraftStore() {
  let internal = $state<Partial<import('$lib/types').Trip> | null>(storage.getDraftTrip());
  return {
    subscribe(run: (v: Partial<import('$lib/types').Trip> | null) => void) {
      run(internal);
      $effect(() => run(internal));
      return () => {};
    },
    save: (data: Partial<import('$lib/types').Trip>) => {
      storage.saveDraftTrip(data);
      // update internal and trigger reactivity
      internal = data;
    },
    load: () => storage.getDraftTrip(),
    clear: () => {
      storage.clearDraftTrip();

      internal = null;
    }
  } as const;
}

export const draftTrip = createDraftStore();

syncManager.registerStore('trips', {
  updateLocal: (trip: unknown) => trips.updateLocal(trip as TripRecord),
  syncDown: async () => {
    const user = auth.user as User | null;
    if (user?.id) await trips.syncFromCloud(user.id);
  }
});
