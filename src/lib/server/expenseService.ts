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

			// 1. Check migration status (Lazy Migration)
			const statusRes = await stub.fetch(`${DO_ORIGIN}/expenses/status`);
			if (statusRes.ok) {
				const status = (await statusRes.json()) as { needsMigration: boolean };

				if (status.needsMigration) {
					log.debug(`[ExpenseService] Migrating expenses for ${userId} to SQL...`);
					const prefix = `expense:${userId}:`;

					// [!code fix] PAGINATION SUPPORT
					// Ensure we fetch ALL keys, not just the first 1000
					const expenses: ExpenseRecord[] = [];
					let list = await kv.list({ prefix });
					let keys = list.keys;

					while (!list.list_complete && list.cursor) {
						list = await kv.list({ prefix, cursor: list.cursor });
						keys = keys.concat(list.keys);
					}

					for (const key of keys) {
						const raw = await kv.get(key.name);
						if (raw) expenses.push(JSON.parse(raw));
					}

					// Bulk Insert to DO
					await stub.fetch(`${DO_ORIGIN}/expenses/migrate`, {
						method: 'POST',
						body: JSON.stringify(expenses)
					});
				}
			}

			// 2. Fetch from SQL (Fast)
			const res = await stub.fetch(`${DO_ORIGIN}/expenses/list`);
			if (!res.ok) {
				log.error(`[ExpenseService] DO Error: ${res.status}`);
				return [];
			}

			const expenses = (await res.json()) as ExpenseRecord[];

			// Delta Sync Logic
			if (since) {
				const sinceDate = new Date(since);
				return expenses.filter((e) => new Date(e.updatedAt || e.createdAt) > sinceDate);
			}

			return expenses;
		},

		async get(userId: string, id: string) {
			// Optimistic fetch from list (since SQL is fast)
			// Ideally we'd add a GET /expenses/item endpoint later
			const all = await this.list(userId);
			return all.find((e) => e.id === id) || null;
		},

		async put(expense: ExpenseRecord) {
			expense.updatedAt = new Date().toISOString();
			delete expense.deleted;
			delete (expense as Record<string, unknown>)['deletedAt'];

			const stub = getIndexStub(expense.userId);
			await stub.fetch(`${DO_ORIGIN}/expenses/put`, {
				method: 'POST',
				body: JSON.stringify(expense)
			});

			// Backfill into KV for compatibility with older tooling that reads `BETA_LOGS_KV`.
			// This is best-effort: don't block the DO write if KV fails.
			try {
				const payload = { ...expense } as Record<string, unknown>;
				// Remove any UI-only fields before persisting to KV
				if (payload['store']) delete payload['store'];
				await kv.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(payload));
			} catch (err) {
				log.warn(`[ExpenseService] KV write failed for expense ${expense.id}`);
			}
		},

		async delete(userId: string, id: string) {
			const stub = getIndexStub(userId);

			// 1. Fetch item for Trash logic
			const item = await this.get(userId, id);
			if (!item) return;

			const now = new Date();

			// 2. Move to Trash KV
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

			// 3. Delete from SQL
			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id })
			});

			// 4. Clean up old KV (Eventual consistency cleanup)
			// This ensures we don't leave stale data in the old system
			await kv.delete(`expense:${userId}:${id}`);
		}
	};
}
