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

			// SELF-HEALING: If Index is empty but KV has data, force sync.
			// This fixes the "I see it in KV but not on other device" issue.
			if (expenses.length === 0) {
				// Check if we actually have data in KV
				const kvCheck = await kv.list({ prefix, limit: 1 });

				if (kvCheck.keys.length > 0) {
					log.info(
						`[ExpenseService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
					);

					// Fetch ALL data from KV
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

					// Force Push to DO
					if (allExpenses.length > 0) {
						await stub.fetch(`${DO_ORIGIN}/expenses/migrate`, {
							method: 'POST',
							body: JSON.stringify(allExpenses)
						});

						// Update local variable to return the fresh data immediately
						expenses = allExpenses;
					}
				}
			}

			// Delta Sync Logic
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

			// 1. Write to KV (The Log)
			await kv.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(expense));

			// 2. Write to DO (The Index)
			const stub = getIndexStub(expense.userId);
			await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
				method: 'POST',
				body: JSON.stringify(expense)
			});
		},

		async delete(userId: string, id: string) {
			const stub = getIndexStub(userId);
			const item = await this.get(userId, id);
			if (!item) return;

			const now = new Date();

			if (trashKV) {
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
				const metadata = {
					deletedAt: now.toISOString(),
					deletedBy: userId,
					originalKey: `expense:${userId}:${id}`,
					expiresAt: expiresAt.toISOString()
				};
				const trashItem = { type: 'expense', data: item, metadata };
				await trashKV.put(`trash:${userId}:${id}`, JSON.stringify(trashItem), {
					expirationTtl: 30 * 24 * 60 * 60
				});
			}

			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id })
			});

			await kv.delete(`expense:${userId}:${id}`);
		}
	};
}
