// src/lib/server/expenseService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';

// [!code fix] Add this import (assuming TrashRecord is defined in types or just define a local interface)
// If you have a shared type file, import it. Otherwise, define it locally to satisfy the linter.
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
					for (const key of keys) {
						const raw = await kv.get(key.name);
						if (!raw) continue;
						const parsed = JSON.parse(raw);

						if (parsed && parsed.deleted) {
							if (parsed.backup) {
								allExpenses.push(parsed.backup);
								migratedCount++;
							} else {
								skippedTombstones++;
							}
							continue;
						}

						allExpenses.push(parsed);
						migratedCount++;
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

			if (since) {
				const sinceDate = new Date(since);
				return expenses.filter((e) => new Date(e.updatedAt || e.createdAt) > sinceDate);
			}

			return expenses;
		},

		async get(userId: string, id: string) {
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
			const item = await this.get(userId, id);
			if (!item) return;

			const now = new Date();
			const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

			const metadata = {
				deletedAt: now.toISOString(),
				deletedBy: userId,
				originalKey: `expense:${userId}:${id}`,
				expiresAt: expiresAt.toISOString()
			};

			const tombstone = {
				id: item.id,
				userId: item.userId,
				deleted: true,
				deletedAt: now.toISOString(),
				deletedBy: userId,
				metadata,
				backup: item,
				updatedAt: now.toISOString(),
				createdAt: item.createdAt
			};

			await kv.put(`expense:${userId}:${id}`, JSON.stringify(tombstone), {
				expirationTtl: RETENTION.THIRTY_DAYS
			});

			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id })
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
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (!parsed || !parsed.deleted) continue;

				const id = (parsed.id as string) || String(k.name.split(':').pop() || '');
				const uid = (parsed.userId as string) || String(k.name.split(':')[1] || '');
				const metadata = (parsed.metadata as Record<string, unknown>) || {
					deletedAt: (parsed.deletedAt as string) || '',
					deletedBy: (parsed.deletedBy as string) || uid,
					originalKey: k.name,
					expiresAt: (parsed.metadata as Record<string, unknown>)?.expiresAt || ''
				};

				const backup =
					(parsed.backup as Record<string, unknown>) ||
					(parsed.data as Record<string, unknown>) ||
					(parsed.expense as Record<string, unknown>) ||
					(parsed as Record<string, unknown>) ||
					{};
				out.push({
					id,
					userId: uid,
					metadata: metadata as TrashRecord['metadata'],
					recordType: 'expense',
					category: (backup.category as string) || undefined,
					amount:
						typeof (backup.amount as unknown) === 'number' ? (backup.amount as number) : undefined,
					description: (backup.description as string) || undefined,
					date: (backup.date as string) || undefined
				});
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
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				if (parsed && parsed.deleted) {
					await kv.delete(k.name);
					count++;
				}
			}
			return count;
		},

		async restore(userId: string, itemId: string) {
			const key = `expense:${userId}:${itemId}`;
			const raw = await kv.get(key);
			if (!raw) throw new Error('Item not found in trash');
			const parsed = JSON.parse(raw);
			if (!parsed || !parsed.deleted) throw new Error('Item is not deleted');
			const backup = parsed.backup || parsed.data || parsed.expense;
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
			// Also notify DO to remove it from index so it doesn't reappear in list()
			const stub = getIndexStub(userId);
			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id: itemId })
			});
		}
	};
}