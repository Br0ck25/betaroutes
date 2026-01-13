// src/lib/server/expenseService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { DO_ORIGIN, RETENTION } from '$lib/constants';
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
	kvs: KVNamespace | KVNamespace[],
	tripIndexDO: DurableObjectNamespace,
	trashKV?: KVNamespace
) {
	const kvList = Array.isArray(kvs) ? kvs : [kvs];
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

					// [!code fix] PAGINATION SUPPORT + MULTI-KV
					// Ensure we fetch ALL keys across all configured KVs
					const expenses: ExpenseRecord[] = [];
					const seenKeys = new Set<string>();

					for (const storeKV of kvList) {
						let list = await storeKV.list({ prefix });
						let keys = list.keys;

						while (!list.list_complete && list.cursor) {
							list = await storeKV.list({ prefix, cursor: list.cursor });
							keys = keys.concat(list.keys);
						}

						for (const key of keys) {
							if (seenKeys.has(key.name)) continue;
							seenKeys.add(key.name);
							const raw = await storeKV.get(key.name);
							if (raw) expenses.push(JSON.parse(raw));
						}
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

			let expenses = (await res.json()) as ExpenseRecord[];
			const doIds = new Set(expenses.map((e) => e.id));
			const kvOnlyIds = new Set<string>();

			// --- Compatibility fallback: merge any KV-only entries (helps when clients
			// write directly to KV instead of going through the DO/API). DO remains authoritative.
			try {
				const prefix = `expense:${userId}:`;
				const seen = new Set<string>();

				for (const storeKV of kvList) {
					let list = await storeKV.list({ prefix });
					let keys = list.keys;

					while (!list.list_complete && list.cursor) {
						list = await storeKV.list({ prefix, cursor: list.cursor });
						keys = keys.concat(list.keys);
					}

					for (const k of keys) {
						if (seen.has(k.name)) continue;
						seen.add(k.name);
						try {
							const raw = await storeKV.get(k.name);
							if (!raw) continue;
							const parsed = JSON.parse(raw) as ExpenseRecord;
							if (!expenses.find((e) => e.id === parsed.id)) {
								expenses.push(parsed);
								if (!doIds.has(parsed.id)) kvOnlyIds.add(parsed.id);
							}
						} catch (err) {
							log.warn(`[ExpenseService] Failed to read KV key ${k.name}`);
						}
					}
				}
			} catch (err) {
				log.warn('[ExpenseService] KV merge failed:', err);
			}

			// Deduplicate and sort by updated/created time (newest first)
			expenses = Object.values(
				expenses.reduce<Record<string, ExpenseRecord>>((acc, e) => {
					acc[e.id] = acc[e.id]
						? new Date(e.updatedAt || e.createdAt) >
							new Date(acc[e.id].updatedAt || acc[e.id].createdAt)
							? e
							: acc[e.id]
						: e;
					return acc;
				}, {})
			).sort(
				(a, b) =>
					new Date(b.updatedAt || b.createdAt).getTime() -
					new Date(a.updatedAt || a.createdAt).getTime()
			);

			// Delta Sync Logic
			if (since) {
				const sinceDate = new Date(since);
				return expenses.filter(
					(e) => new Date(e.updatedAt || e.createdAt) > sinceDate || kvOnlyIds.has(e.id)
				);
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
			const payload = { ...expense } as Record<string, unknown>;
			if (payload['store']) delete payload['store'];
			await Promise.allSettled(
				kvList.map(async (storeKV) => {
					try {
						await storeKV.put(`expense:${expense.userId}:${expense.id}`, JSON.stringify(payload));
					} catch (err) {
						log.warn(`[ExpenseService] KV write failed for expense ${expense.id} in one KV`, err);
					}
				})
			);
		},

		async delete(userId: string, id: string) {
			const stub = getIndexStub(userId);

			// 1. Fetch item for Trash logic
			const item = await this.get(userId, id);
			if (!item) return;

			const now = new Date();

			// 2. Move to Trash KV (store a structured payload like trips)
			if (trashKV) {
				const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);
				const metadata = {
					deletedAt: now.toISOString(),
					deletedBy: userId,
					originalKey: `expense:${userId}:${id}`,
					expiresAt: expiresAt.toISOString()
				};
				const trashItem = { type: 'expense', data: item, metadata };
				await trashKV.put(`trash:${userId}:${id}`, JSON.stringify(trashItem), {
					expirationTtl: RETENTION.THIRTY_DAYS
				});
			}

			// 3. Delete from SQL (mark as deleted in DO/SQL)
			await stub.fetch(`${DO_ORIGIN}/expenses/delete`, {
				method: 'POST',
				body: JSON.stringify({ id })
			});

			// 4. Write tombstone to KV instead of deleting it outright so other clients
			// can detect the deletion during delta sync (mirror trip behavior)
			const tombstone = {
				id: item.id,
				userId: item.userId,
				deleted: true,
				deletedAt: now.toISOString(),
				updatedAt: now.toISOString(),
				createdAt: (item as any).createdAt
			};
			await Promise.allSettled(
				kvList.map(async (storeKV) => {
					try {
						await storeKV.put(`expense:${userId}:${id}`, JSON.stringify(tombstone), {
							expirationTtl: RETENTION.THIRTY_DAYS
						});
					} catch (err) {
						log.warn(`[ExpenseService] Failed to write tombstone for expense ${id} in one KV`);
					}
				})
			);
		}
	};
}
