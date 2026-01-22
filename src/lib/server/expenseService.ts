// src/lib/server/expenseService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
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

	// Helper to fetch all expenses from KV for a given prefix (including tombstones for migration)
	async function fetchFromKV(prefix: string, includeTombstones = false): Promise<ExpenseRecord[]> {
		const all: ExpenseRecord[] = [];
		let list = await kv.list({ prefix });
		let keys = list.keys;

		while (!list.list_complete && list.cursor) {
			list = await kv.list({ prefix, cursor: list.cursor });
			keys = keys.concat(list.keys);
		}

		for (const key of keys) {
			const raw = await kv.get(key.name);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (parsed) {
					if (parsed['deleted'] && parsed['backup']) {
						if (includeTombstones) {
							// For migration: return the full tombstone with deleted flag
							all.push(parsed as ExpenseRecord);
						} else {
							all.push(parsed['backup'] as ExpenseRecord);
						}
					} else if (!parsed['deleted']) {
						all.push(parsed as ExpenseRecord);
					} else if (parsed['deleted'] && includeTombstones) {
						// Tombstone without backup - still include for migration
						all.push(parsed as ExpenseRecord);
					}
				}
			} catch {
				// Skip corrupt entries
			}
		}
		return all;
	}

	return {
		/**
		 * List expense records for a user.
		 * @param userId - Primary storage ID (UUID)
		 * @param since - Optional ISO date for delta sync
		 */
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
					// Check if we recently did a repair (debounce)
					const repairKey = `meta:expense_repair:${userId}`;
					const lastRepair = await kv.get(repairKey);
					if (lastRepair) {
						log.info(`[ExpenseService] Skipping repair for ${userId} - throttled (recent repair)`);
						// Return empty to avoid DoS; client will retry later
						return [];
					}

					// Mark that we're repairing (expires in 60 seconds)
					await kv.put(repairKey, new Date().toISOString(), { expirationTtl: 60 });

					log.info(
						`[ExpenseService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
					);

					const allExpenses = await fetchFromKV(prefix);
					if (allExpenses.length > 0) {
						await stub.fetch(`${DO_ORIGIN}/expenses/migrate`, {
							method: 'POST',
							body: JSON.stringify(allExpenses)
						});

						expenses = allExpenses;
						log.info(`[ExpenseService] Migrated ${allExpenses.length} items`);
					}
				}
			}

			// Delta Sync Logic: Return everything (including tombstones) that changed
			if (since) {
				const sinceDate = new Date(since);
				const filtered = expenses.filter((e) => new Date(e.updatedAt || e.createdAt) > sinceDate);
				log.info(
					`[ExpenseService] list() delta sync returning ${filtered.length} of ${expenses.length} items`
				);
				return filtered;
			}

			// Full List Logic: MUST filter out deleted items
			const deletedCount = expenses.filter((e) => e.deleted).length;
			const activeItems = expenses.filter((e) => !e.deleted);
			log.info(
				`[ExpenseService] list() returning ${activeItems.length} active items (${deletedCount} deleted filtered out)`
			);
			return activeItems;
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
			log.info(`[ExpenseService] delete() called`, { userId, id });
			const stub = getIndexStub(userId);

			// We need to fetch from KV directly to ensure we get the latest data for backup
			const key = `expense:${userId}:${id}`;
			log.info(`[ExpenseService] Checking key: ${key}`);
			const raw = await kv.get(key);

			if (!raw) {
				log.warn(`[ExpenseService] delete() - Item not found in KV`, { key });
				return;
			}
			log.info(`[ExpenseService] Found item to delete, creating tombstone`);

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
				userId,
				deleted: true,
				deletedAt: now.toISOString(),
				deletedBy: userId,
				metadata,
				backup: item,
				updatedAt: now.toISOString(),
				createdAt: (item['createdAt'] as string) || ''
			};

			// 1. Write tombstone to KV
			await kv.put(key, JSON.stringify(tombstone), {
				expirationTtl: RETENTION.THIRTY_DAYS
			});
			log.info(`[ExpenseService] Wrote tombstone to: ${key}`);

			// 2. Update DO with tombstone (PUT) instead of deleting
			// This is CRITICAL for sync to work. Devices need to download this record
			// to know it has been deleted.
			await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
				method: 'POST',
				body: JSON.stringify(tombstone)
			});
		},

		async listTrash(userId: string) {
			log.info(`[ExpenseService] listTrash() called`, { userId });
			const out: TrashRecord[] = [];
			const prefix = `expense:${userId}:`;

			log.info(`[ExpenseService] listTrash scanning prefix: ${prefix}`);
			let list = await kv.list({ prefix });
			let keys = list.keys;
			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}
			log.info(`[ExpenseService] listTrash found ${keys.length} keys under ${prefix}`);

			let tombstoneCount = 0;
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (!parsed || !parsed['deleted']) continue;
				tombstoneCount++;

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
				out.push({
					id,
					userId: uid,
					metadata: metadata as TrashRecord['metadata'],
					recordType: 'expense',
					category: (backup['category'] as string) || undefined,
					amount:
						typeof (backup['amount'] as unknown) === 'number'
							? (backup['amount'] as number)
							: undefined,
					description: (backup['description'] as string) || undefined,
					date: (backup['date'] as string) || undefined
				});
			}
			log.info(`[ExpenseService] listTrash found ${tombstoneCount} tombstones under ${prefix}`);

			log.info(`[ExpenseService] listTrash returning ${out.length} tombstones`);
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
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				if (parsed && parsed.deleted) {
					await kv.delete(k.name);
					// Also ensure it's gone from DO
					const stub = getIndexStub(userId);
					const id = k.name.split(':').pop();
					if (id) {
						await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
							method: 'POST',
							body: JSON.stringify({ id })
						});
					}
					count++;
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
