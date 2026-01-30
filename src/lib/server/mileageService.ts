// src/lib/server/mileageService.ts

import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';
import { calculateFuelCost } from '$lib/utils/calculations';

export interface MileageRecord {
  id: string;
  userId: string;
  /** Optional link to parent trip */
  tripId?: string;
  date?: string;
  startOdometer?: number;
  endOdometer?: number;
  miles: number;
  reimbursement?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export function makeMileageService(
  kv: KVNamespace,
  tripIndexDO: DurableObjectNamespace,
  tripKV?: KVNamespace
) {
  const getIndexStub = (userId: string) => {
    const id = tripIndexDO.idFromName(userId);
    return tripIndexDO.get(id);
  };

  return {
    async list(userId: string, since?: string): Promise<MileageRecord[]> {
      const stub = getIndexStub(userId);
      const prefix = `mileage:${userId}:`;

      // 1. Try to fetch from Durable Object index first
      let mileage: MileageRecord[] = [];
      try {
        const res = await stub.fetch(`${DO_ORIGIN}/mileage/list`);
        if (res.ok) {
          mileage = (await res.json()) as MileageRecord[];
        } else {
          log.error(`[MileageService] DO Error: ${res.status}`);
        }
      } catch (err) {
        log.warn('[MileageService] DO fetch failed, falling back to KV', err);
      }

      // SELF-HEALING: If Index is empty but KV has data, force sync/migrate
      if (mileage.length === 0) {
        const kvCheck = await kv.list({ prefix, limit: 1 });

        if (kvCheck.keys.length > 0) {
          log.info(
            `[MileageService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
          );

          // Fetch ALL data from KV
          const all: MileageRecord[] = [];
          let list = await kv.list({ prefix });
          let keys = list.keys;

          while (!list.list_complete && list.cursor) {
            list = await kv.list({ prefix, cursor: list.cursor });
            keys = keys.concat(list.keys);
          }

          let migratedCount = 0;
          const skippedTombstones = 0;

          // [!code fix] SECURITY: Use batched fetch to avoid Cloudflare subrequest limits (1000 per request)
          const BATCH_SIZE = 50;
          for (let i = 0; i < keys.length; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map((k) => kv.get(k.name)));
            for (const raw of results) {
              if (!raw) continue;
              const parsed = JSON.parse(raw);

              // Migrate all records including tombstones (to maintain deleted state)
              if (parsed && parsed.deleted) {
                // Push the tombstone itself, not the backup
                all.push(parsed);
                migratedCount++;
                continue;
              }

              all.push(parsed);
              migratedCount++;
            }
          }

          // Force Push to DO
          if (all.length > 0) {
            await stub.fetch(`${DO_ORIGIN}/mileage/migrate`, {
              method: 'POST',
              body: JSON.stringify(all)
            });

            mileage = all;
            log.info(
              `[MileageService] Migrated ${migratedCount} items (${skippedTombstones} tombstones included)`
            );
          }
        }
      }

      // Delta Sync: Return everything (including deletions)
      if (since) {
        const sinceDate = new Date(since);
        return mileage.filter((m) => new Date(m.updatedAt || m.createdAt) > sinceDate);
      }

      // [!code fix] Full List: Filter out deleted items (Tombstones)
      // This prevents deleted items from appearing on page load/refresh
      return mileage
        .filter((m) => !m.deleted)
        .sort((a, b) =>
          (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
        );
    },

    async get(userId: string, id: string) {
      const all = await this.list(userId);
      return all.find((m) => m.id === id) || null;
    },

    async put(item: MileageRecord) {
      item.updatedAt = new Date().toISOString();
      delete item.deleted;

      // Write to KV
      await kv.put(`mileage:${item.userId}:${item.id}`, JSON.stringify(item));

      // Write to DO
      const stub = getIndexStub(item.userId);
      await stub.fetch(`${DO_ORIGIN}/mileage/put`, {
        method: 'POST',
        body: JSON.stringify(item)
      });
    },

    async delete(userId: string, id: string) {
      const stub = getIndexStub(userId);

      const key = `mileage:${userId}:${id}`;
      const raw = await kv.get(key);
      if (!raw) return;

      const item = JSON.parse(raw) as MileageRecord;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

      const metadata = {
        deletedAt: now.toISOString(),
        deletedBy: userId,
        originalKey: key,
        expiresAt: expiresAt.toISOString()
      };

      const tombstone = {
        id: item.id,
        userId: item.userId,
        deleted: true,
        deletedAt: now.toISOString(),
        metadata,
        backup: item,
        updatedAt: now.toISOString(),
        createdAt: item.createdAt
      };

      // Update KV with tombstone
      await kv.put(key, JSON.stringify(tombstone), {
        expirationTtl: RETENTION.THIRTY_DAYS
      });

      // Update DO with tombstone (PUT)
      await stub.fetch(`${DO_ORIGIN}/mileage/put`, {
        method: 'POST',
        body: JSON.stringify(tombstone)
      });

      // If the deleted mileage was linked to a trip, set that trip's totalMiles and fuelCost to 0
      if (tripKV) {
        try {
          // Legacy support: use item.tripId when present, otherwise fallback to the mileage id
          const tripIdToUpdate =
            typeof item.tripId === 'string' && item.tripId ? item.tripId : item.id;
          if (tripIdToUpdate) {
            const tripKey = `trip:${userId}:${tripIdToUpdate}`;
            const tripRaw = await tripKV.get(tripKey);
            if (tripRaw) {
              const trip = JSON.parse(tripRaw);
              if (!trip.deleted) {
                trip.totalMiles = 0;
                trip.fuelCost = 0;
                trip.updatedAt = now.toISOString();
                await tripKV.put(tripKey, JSON.stringify(trip));
                log.info(
                  `[MileageService] Set trip ${tripIdToUpdate} totalMiles and fuelCost to 0 after mileage deletion`
                );
              }
            }
          }
        } catch (err) {
          log.warn(`[MileageService] Failed to zero trip totalMiles after mileage delete`, {
            id,
            error: err
          });
        }
      }
    },

    async listTrash(userId: string) {
      const prefix = `mileage:${userId}:`;
      let list = await kv.list({ prefix });
      let keys = list.keys;
      while (!list.list_complete && list.cursor) {
        list = await kv.list({ prefix, cursor: list.cursor });
        keys = keys.concat(list.keys);
      }

      const out: Record<string, unknown>[] = [];
      for (const k of keys) {
        const raw = await kv.get(k.name);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Record<string, unknown> | undefined;
        if (!parsed || !(parsed['deleted'] as boolean)) continue;

        const id = (parsed['id'] as string) || String(k.name.split(':').pop() || '');
        const uid = (parsed['userId'] as string) || String(k.name.split(':')[1] || '');
        const parsedMetadata = parsed['metadata'] as Record<string, unknown> | undefined;
        const metadata = parsedMetadata || {
          deletedAt: (parsed['deletedAt'] as string) || '',
          deletedBy: uid,
          originalKey: k.name,
          expiresAt: (parsedMetadata && (parsedMetadata['expiresAt'] as string)) || ''
        };

        const backup =
          (parsed['backup'] as Record<string, unknown> | undefined) ||
          (parsed['data'] as Record<string, unknown> | undefined) ||
          (parsed as Record<string, unknown>);

        out.push({
          id,
          userId: uid,
          metadata: metadata as Record<string, unknown>,
          recordType: 'mileage',
          miles:
            typeof (backup['miles'] as number) === 'number'
              ? (backup['miles'] as number)
              : undefined,
          vehicle: backup['vehicle'],
          date: backup['date']
        });
      }

      out.sort((a, b) =>
        String((b['metadata'] as Record<string, unknown>)['deletedAt'] ?? '').localeCompare(
          String((a['metadata'] as Record<string, unknown>)['deletedAt'] ?? '')
        )
      );
      return out;
    },
    async permanentDelete(userId: string, itemId: string) {
      const key = `mileage:${userId}:${itemId}`;
      await kv.delete(key);

      const stub = getIndexStub(userId);
      await stub.fetch(`${DO_ORIGIN}/mileage/delete`, {
        method: 'POST',
        body: JSON.stringify({ id: itemId })
      });
    },

    async restore(userId: string, itemId: string) {
      const key = `mileage:${userId}:${itemId}`;
      const raw = await kv.get(key);
      if (!raw) throw new Error('Item not found');

      const tombstone = JSON.parse(raw) as Record<string, unknown>;
      if (!tombstone['deleted']) throw new Error('Item not deleted');

      // Validation: Only validate parent trip if the tombstone being restored has a linked tripId
      if (tripKV) {
        const backup =
          (tombstone['backup'] as Record<string, unknown> | undefined) ||
          (tombstone['data'] as Record<string, unknown> | undefined) ||
          tombstone;
        const linkedTripId =
          typeof backup['tripId'] === 'string' ? (backup['tripId'] as string) : undefined;
        if (linkedTripId) {
          const tripKey = `trip:${userId}:${linkedTripId}`;
          const tripRaw = await tripKV.get(tripKey);

          if (!tripRaw) {
            throw new Error('Parent trip not found. Cannot restore mileage log.');
          }

          const trip = JSON.parse(tripRaw);
          if (trip.deleted) {
            throw new Error(
              'Parent trip is deleted. Please restore the trip first before restoring the mileage log.'
            );
          }
        }
      }

      // FIX: Get the full backup data and preserve ALL fields
      const backup =
        (tombstone['backup'] as Record<string, unknown> | undefined) ||
        (tombstone['data'] as Record<string, unknown> | undefined) ||
        tombstone;

      // Create restored record with all original fields preserved
      const restored = {
        ...backup,
        updatedAt: new Date().toISOString()
      } as MileageRecord & Record<string, unknown>;

      // Clean up unwanted fields
      delete restored['deleted'];
      delete restored['deletedAt'];
      delete restored['metadata'];
      delete restored['backup'];
      delete restored['data'];

      await this.put(restored);

      // Update the parent trip's totalMiles and fuelCost to reflect the restored mileage (only if linked to a tripId)
      const restoredTripId = typeof restored.tripId === 'string' ? restored.tripId : undefined;
      if (tripKV && restoredTripId && typeof restored.miles === 'number') {
        try {
          const tripKey = `trip:${userId}:${restoredTripId}`;
          const tripRaw = await tripKV.get(tripKey);
          if (tripRaw) {
            const trip = JSON.parse(tripRaw);
            if (!trip.deleted) {
              trip.totalMiles = restored.miles;
              // Recalculate fuel cost based on restored miles using shared utility
              const mpg = Number(trip.mpg) || 0;
              const gasPrice = Number(trip.gasPrice) || 0;
              trip.fuelCost = calculateFuelCost(restored.miles, mpg, gasPrice);
              trip.updatedAt = new Date().toISOString();
              await tripKV.put(tripKey, JSON.stringify(trip));
              log.info(
                `[MileageService] Updated trip ${restoredTripId} totalMiles to ${restored.miles} and fuelCost to ${trip.fuelCost} after mileage restore`
              );
            }
          }
        } catch (err) {
          log.warn(`[MileageService] Failed to update trip totalMiles after mileage restore`, {
            itemId,
            error: err
          });
        }
      }

      return restored;
    }
  };
}
