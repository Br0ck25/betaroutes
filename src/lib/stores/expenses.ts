// src/lib/server/expenseService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { DO_ORIGIN } from '$lib/constants';
import { log } from '$lib/server/log';

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

export function makeExpenseService(
	kv: KVNamespace,
	tripIndexDO: DurableObjectNamespace,
	trashKV?: KVNamespace
) {
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

			// [!code fix] SELF-HEALING: If Index is empty but KV has data, force sync.
			// This repairs the "I see it in KV but app is empty" state
			if (expenses.length === 0) {
				const kvCheck = await kv.list({ prefix, limit: 1 });
				
				if (kvCheck.keys.length > 0) {
					log.info(`[ExpenseService] Detected desync for ${userId} (KV has data, Index empty). repairing...`);
					
					const allExpenses: ExpenseRecord[] = [];
					let list = await kv.list({ prefix });
					let keys = list.keys;

					while (!list.list_complete && list.cursor) {
						list = await kv.list({ prefix, cursor: list.cursor });
						keys = keys.concat(list.keys);
					}

					for (const key of keys) {
						const raw = await kv.get(key.name);
						if (raw) allExpenses.push(JSON.parse(raw));
					}

					if (allExpenses.length > 0) {
						await stub.fetch(`${DO_ORIGIN}/expenses/migrate`, {
							method: 'POST',
							body: JSON.stringify(allExpenses)
						});
						// Return fresh data immediately
						expenses = allExpenses;
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

			// [!code fix] Write to KV (The Log) - Ensure data persists in main DB
			await kv.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(expense));

			// Write to DO (The Index)
			const stub = getIndexStub(expense.userId);
			await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
				method: 'POST',
				body: JSON.stringify(expense)
			});
		},

		async delete(userId: string, id: string) {
			const stub = getIndexStub(userId);

			// 1. Fetch item for Trash logic
			// [!code fix] Fallback to KV if not found in DO (ensures deletion works even if desynced)
			let item = await this.get(userId, id);
			
			if (!item) {
				const raw = await kv.get(`expense:${userId}:${id}`);
				if (raw) {
					item = JSON.parse(raw);
					log.info('[ExpenseService] Found item in KV for deletion (missing in DO)', { id });
				}
			}

			if (!item) {
				log.warn('[ExpenseService] Item not found for deletion, skipping trash', { id });
				// Even if not found, we continue to delete commands to ensure cleanup
			} else {
				// 2. Move to Trash KV
				if (trashKV) {
					const now = new Date();
					const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
					const metadata = {
						deletedAt: now.toISOString(),
						deletedBy: userId,
						originalKey: `expense:${userId}:${id}`,
						expiresAt: expiresAt.toISOString()
					};
					// Store with 'data' wrapper for consistency with normalization logic
					const trashItem = { type: 'expense', data: item, metadata };
					
					await trashKV.put(`trash:${userId}:${id}`, JSON.stringify(trashItem), {
						expirationTtl: 30 * 24 * 60 * 60
					});
					log.info('[ExpenseService] Moved to trash', { id });
				} else {
					log.error('[ExpenseService] Trash KV binding missing!');
				}
			}

			// 3. Delete from SQL
			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id })
			});

			// 4. Clean up old KV
			await kv.delete(`expense:${userId}:${id}`);
		}
	};
}