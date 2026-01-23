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

	return {
		async list(userId: string, since?: string, userName?: string): Promise<ExpenseRecord[]> {
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

				// MIGRATION: Also check legacy key if userName provided
				let hasLegacyData = false;
				if (kvCheck.keys.length === 0 && userName && userName !== userId) {
					const legacyPrefix = `expense:${userName}:`;
					const legacyCheck = await kv.list({ prefix: legacyPrefix, limit: 1 });
					hasLegacyData = legacyCheck.keys.length > 0;
					if (hasLegacyData) {
						log.info('[MIGRATION] Found legacy expenses', { userId, userName });
					}
				}

				if (kvCheck.keys.length > 0 || hasLegacyData) {
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

					// MIGRATION: Also fetch from legacy keys if userName provided
					if (userName && userName !== userId) {
						const legacyPrefix = `expense:${userName}:`;
						let legacyList = await kv.list({ prefix: legacyPrefix });
						if (legacyList.keys.length > 0) {
							keys = keys.concat(legacyList.keys);
							while (!legacyList.list_complete && legacyList.cursor) {
								legacyList = await kv.list({ prefix: legacyPrefix, cursor: legacyList.cursor });
								keys = keys.concat(legacyList.keys);
							}
						}
					}

					let migratedCount = 0;
					let skippedTombstones = 0;
					for (const key of keys) {
						const raw = await kv.get(key.name);
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

		async get(userId: string, id: string, userName?: string) {
			// Try new key format first (user ID based)
			const key = `expense:${userId}:${id}`;
			let raw = await kv.get(key);

			// MIGRATION: If not found and we have username, try legacy key
			if (!raw && userName && userName !== userId) {
				const legacyKey = `expense:${userName}:${id}`;
				raw = await kv.get(legacyKey);
				if (raw) {
					log.info('[MIGRATION] Found expense via legacy key', { userId, id, legacyKey });
				}
			}

			return raw ? (JSON.parse(raw) as ExpenseRecord) : null;
		},

		async put(expense: ExpenseRecord) {
			expense.updatedAt = new Date().toISOString();
			delete expense.deleted;

			await kv.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(expense));

			// Write to DO index
			try {
				const stub = getIndexStub(expense.userId);
				const res = await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
					method: 'POST',
					body: JSON.stringify(expense)
				});

				if (!res.ok) {
					log.error('[ExpenseService] DO put failed', { status: res.status, id: expense.id });
					// Retry once
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
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (!parsed || !parsed['deleted']) continue;

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
