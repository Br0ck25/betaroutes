// src/lib/server/expenseService.ts

import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';

// Define locally to avoid missing import errors
export interface TrashRecord {
  id: string;
  userId: string;
  metadata: {
    deletedAt: string;
    deletedBy: string;
    originalKey: string;
    expiresAt: string;
  };
  recordType: 'expense';
  category?: string;
  amount?: number;
  description?: string;
  date?: string;
}

export interface ExpenseRecord {
  id: string;
  userId: string;
  date: string;
  category: string;
  amount: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export function makeExpenseService(kv: KVNamespace, tripIndexDO: DurableObjectNamespace) {
  const getIndexStub = (userId: string) => {
    const id = tripIndexDO.idFromName(userId);
    return tripIndexDO.get(id);
  };

  return {
    async list(userId: string, since?: string): Promise<ExpenseRecord[]> {
      const stub = getIndexStub(userId);
      const prefix = `expense:${userId}:`;

      // 1. Try to fetch from SQL Index (Durable Object) first
      const res = await stub.fetch(`${DO_ORIGIN}/expenses/list`);

      let expenses: ExpenseRecord[] = [];
      if (res.ok) {
        expenses = (await res.json()) as ExpenseRecord[];
      } else {
        log.error(`[ExpenseService] DO Error: ${res.status}`);
      }

      // SELF-HEALING: If Index is empty but KV has data, force sync.
      if (expenses.length === 0) {
        const kvCheck = await kv.list({ prefix, limit: 1 });

        if (kvCheck.keys.length > 0) {
          log.info(
            `[ExpenseService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
          );

          const allExpenses: ExpenseRecord[] = [];
          let list = await kv.list({ prefix });
          let keys = list.keys;

          while (!list.list_complete && list.cursor) {
            list = await kv.list({ prefix, cursor: list.cursor });
            keys = keys.concat(list.keys);
          }

          let migratedCount = 0;
          let skippedTombstones = 0;

          // [!code fix] SECURITY: Use batched fetch to avoid Cloudflare subrequest limits (1000 per request)
          const BATCH_SIZE = 50;
          for (let i = 0; i < keys.length; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map((k) => kv.get(k.name)));
            for (const raw of results) {
              if (!raw) continue;
              const parsed = JSON.parse(raw) as Record<string, unknown>;

              if (parsed && parsed['deleted']) {
                if (parsed['backup']) {
                  allExpenses.push(parsed['backup'] as ExpenseRecord);
                  migratedCount++;
                } else {
                  skippedTombstones++;
                }
                continue;
              }

              allExpenses.push(parsed as ExpenseRecord);
              migratedCount++;
            }
          }
          if (allExpenses.length > 0) {
            await stub.fetch(`${DO_ORIGIN}/expenses/migrate`, {
              method: 'POST',
              body: JSON.stringify(allExpenses)
            });

            expenses = allExpenses;
            log.info(
              `[ExpenseService] Migrated ${migratedCount} items (${skippedTombstones} tombstones skipped)`
            );
          }
        }
      }

      // Delta Sync Logic: Return everything (including tombstones) that changed
      if (since) {
        const sinceDate = new Date(since);
        return expenses.filter((e) => new Date(e.updatedAt || e.createdAt) > sinceDate);
      }

      // [!code fix] Full List Logic: MUST filter out deleted items
      // This ensures 'hydrate' sees items missing and removes them locally
      return expenses.filter((e) => !e.deleted);
    },

    /**
     * Atomically check and increment the monthly expense quota.
     * Uses Durable Object to prevent race conditions.
     * @returns { allowed: boolean, count: number }
     */
    async checkMonthlyQuota(
      userId: string,
      limit: number
    ): Promise<{ allowed: boolean; count: number }> {
      const date = new Date();
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const stub = getIndexStub(userId);

      const res = await stub.fetch(`${DO_ORIGIN}/expenses/check-increment`, {
        method: 'POST',
        body: JSON.stringify({ monthKey, limit })
      });
      if (!res.ok) return { allowed: false, count: limit };
      return (await res.json()) as { allowed: boolean; count: number };
    },

    async get(userId: string, id: string) {
      // Reuse list to ensure consistent behavior
      const all = await this.list(userId);
      return all.find((e) => e.id === id) || null;
    },

    async put(expense: ExpenseRecord) {
      expense.updatedAt = new Date().toISOString();
      delete expense.deleted;
      delete (expense as Record<string, unknown>)['deletedAt'];

      await kv.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(expense));

      const stub = getIndexStub(expense.userId);
      try {
        const res = await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
          method: 'POST',
          body: JSON.stringify(expense)
        });
        if (!res.ok) {
          log.warn('[ExpenseService] DO put returned non-ok status', {
            status: res.status,
            id: expense.id
          });
          try {
            const retry = await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
              method: 'POST',
              body: JSON.stringify(expense)
            });
            if (!retry.ok) {
              log.error('[ExpenseService] DO put retry failed', {
                status: retry.status,
                id: expense.id
              });
            }
          } catch (e) {
            log.error('[ExpenseService] DO put retry threw', {
              message: (e as Error).message,
              id: expense.id
            });
          }
        }
      } catch (e) {
        log.error('[ExpenseService] DO put failed', {
          message: (e as Error).message,
          id: expense.id
        });
      }
    },

    async delete(userId: string, id: string) {
      const stub = getIndexStub(userId);

      // We need to fetch from KV directly to ensure we get the latest data for backup
      // (even if DO is slightly behind)
      const key = `expense:${userId}:${id}`;
      const raw = await kv.get(key);
      if (!raw) return;

      const item = JSON.parse(raw) as Record<string, unknown>;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

      const metadata = {
        deletedAt: now.toISOString(),
        deletedBy: userId,
        originalKey: key,
        expiresAt: expiresAt.toISOString()
      };

      const tombstone = {
        id: (item['id'] as string) || id,
        userId: (item['userId'] as string) || userId,
        deleted: true,
        deletedAt: now.toISOString(),
        deletedBy: userId,
        metadata,
        backup: item,
        updatedAt: now.toISOString(),
        createdAt: (item['createdAt'] as string) || ''
      };

      // 1. Update KV with tombstone
      await kv.put(key, JSON.stringify(tombstone), {
        expirationTtl: RETENTION.THIRTY_DAYS
      });

      // 2. [!code fix] Update DO with tombstone (PUT) instead of deleting
      // This is CRITICAL for sync to work. Devices need to download this record
      // to know it has been deleted.
      await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
        method: 'POST',
        body: JSON.stringify(tombstone)
      });
    },

    async listTrash(userId: string) {
      const prefix = `expense:${userId}:`;
      let list = await kv.list({ prefix });
      let keys = list.keys;
      while (!list.list_complete && list.cursor) {
        list = await kv.list({ prefix, cursor: list.cursor });
        keys = keys.concat(list.keys);
      }

      const out: TrashRecord[] = [];

      // [!code fix] SECURITY: Use batched fetch to avoid Cloudflare subrequest limits (1000 per request)
      const BATCH_SIZE = 50;
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map((k) => kv.get(k.name)));
        for (let j = 0; j < results.length; j++) {
          const raw = results[j];
          if (!raw) continue;
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (!parsed || !parsed['deleted']) continue;

          const k = batch[j];
          if (!k) continue;
          const id = (parsed['id'] as string) || String(k.name.split(':').pop() || '');
          const uid = (parsed['userId'] as string) || String(k.name.split(':')[1] || '');
          const metadata = (parsed['metadata'] as Record<string, unknown>) || {
            deletedAt: (parsed['deletedAt'] as string) || '',
            deletedBy: (parsed['deletedBy'] as string) || uid,
            originalKey: k.name,
            expiresAt: (parsed['metadata'] as Record<string, unknown>)?.['expiresAt'] || ''
          };

          const backup =
            (parsed['backup'] as Record<string, unknown>) ||
            (parsed['data'] as Record<string, unknown>) ||
            (parsed['expense'] as Record<string, unknown>) ||
            (parsed as Record<string, unknown>) ||
            {};
          const rec: Partial<TrashRecord> = {
            id,
            userId: uid,
            metadata: metadata as TrashRecord['metadata'],
            recordType: 'expense'
          };

          const cat = (backup['category'] as string) || undefined;
          if (cat) rec.category = cat;

          const amt =
            typeof (backup['amount'] as unknown) === 'number'
              ? (backup['amount'] as number)
              : undefined;
          if (amt !== undefined) rec.amount = amt;

          const desc = (backup['description'] as string) || undefined;
          if (desc) rec.description = desc;

          const d = (backup['date'] as string) || undefined;
          if (d) rec.date = d;

          out.push(rec as TrashRecord);
        }
      }

      out.sort((a, b) => (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
      return out;
    },

    async emptyTrash(userId: string) {
      const prefix = `expense:${userId}:`;
      let list = await kv.list({ prefix });
      let keys = list.keys;
      while (!list.list_complete && list.cursor) {
        list = await kv.list({ prefix, cursor: list.cursor });
        keys = keys.concat(list.keys);
      }
      let count = 0;

      // [!code fix] SECURITY: Use batched fetch to avoid Cloudflare subrequest limits (1000 per request)
      const BATCH_SIZE = 50;
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map((k) => kv.get(k.name)));

        // Collect items to delete
        const toDelete: { key: string; id: string }[] = [];
        for (let j = 0; j < results.length; j++) {
          const raw = results[j];
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (parsed && parsed.deleted) {
            const batchItem = batch[j];
            if (!batchItem) continue;
            const id = batchItem.name.split(':').pop();
            if (id) {
              toDelete.push({ key: batchItem.name, id });
            }
          }
        }

        // Batch delete from KV and DO
        if (toDelete.length > 0) {
          const stub = getIndexStub(userId);
          await Promise.all([
            ...toDelete.map((item) => kv.delete(item.key)),
            ...toDelete.map((item) =>
              stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
                method: 'POST',
                body: JSON.stringify({ id: item.id })
              })
            )
          ]);
          count += toDelete.length;
        }
      }
      return count;
    },

    async restore(userId: string, itemId: string) {
      const key = `expense:${userId}:${itemId}`;
      const raw = await kv.get(key);
      if (!raw) throw new Error('Item not found in trash');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || !parsed['deleted']) throw new Error('Item is not deleted');
      const backup = (parsed['backup'] || parsed['data'] || parsed['expense']) as
        | Record<string, unknown>
        | undefined;
      if (!backup) throw new Error('Backup data not found in item');
      if ('deletedAt' in backup) delete (backup as Record<string, unknown>)['deletedAt'];
      if ('deleted' in backup) delete (backup as Record<string, unknown>)['deleted'];
      (backup as Record<string, unknown>)['updatedAt'] = new Date().toISOString();

      const restored = backup as ExpenseRecord;
      await kv.put(key, JSON.stringify(restored));
      const stub = getIndexStub(userId);
      await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
        method: 'POST',
        body: JSON.stringify(restored)
      });
      return restored;
    },

    async permanentDelete(userId: string, itemId: string) {
      const key = `expense:${userId}:${itemId}`;
      await kv.delete(key);

      const stub = getIndexStub(userId);
      await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
        method: 'POST',
        body: JSON.stringify({ id: itemId })
      });
    }
  };
}
