// src/lib/server/millageService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { TrashItem } from '$lib/server/tripService';
import { DO_ORIGIN, RETENTION } from '$lib/constants';
import { log } from '$lib/server/log';

export interface MillageRecord {
	id: string;
	userId: string;
	date?: string;
	startOdometer: number;
	endOdometer: number;
	miles: number;
	reimbursement?: number;
	notes?: string;
	createdAt: string;
	updatedAt: string;
	deleted?: boolean;
	[key: string]: unknown;
}

export function makeMillageService(kv: KVNamespace, tripIndexDO: DurableObjectNamespace) {
	const getIndexStub = (userId: string) => {
		const id = tripIndexDO.idFromName(userId);
		return tripIndexDO.get(id);
	};

	return {
		async list(userId: string, since?: string): Promise<MillageRecord[]> {
			const stub = getIndexStub(userId);
			const prefix = `millage:${userId}:`;

			// 1. Try to fetch from Durable Object index first
			let millage: MillageRecord[] = [];
			try {
				const res = await stub.fetch(`${DO_ORIGIN}/millage/list`);
				if (res.ok) {
					millage = (await res.json()) as MillageRecord[];
				} else {
					log.error(`[MillageService] DO Error: ${res.status}`);
				}
			} catch (err) {
				log.warn('[MillageService] DO fetch failed, falling back to KV', err);
			}

			// SELF-HEALING: If Index is empty but KV has data, force sync/migrate
			if (millage.length === 0) {
				const kvCheck = await kv.list({ prefix, limit: 1 });

				if (kvCheck.keys.length > 0) {
					log.info(
						`[MillageService] Detected desync for ${userId} (KV has data, Index empty). repairing...`
					);

					// Fetch ALL data from KV
					const all: MillageRecord[] = [];
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

						// If this is a tombstone, prefer migrating its backup payload (if available)
						if (parsed && parsed.deleted) {
							if (parsed.backup) {
								all.push(parsed.backup);
								migratedCount++;
							} else {
								skippedTombstones++;
							}
							continue;
						}

						all.push(parsed);
						migratedCount++;
					}

					// Force Push to DO
					if (all.length > 0) {
						await stub.fetch(`${DO_ORIGIN}/millage/migrate`, {
							method: 'POST',
							body: JSON.stringify(all)
						});

						millage = all;
						log.info(
							`[MillageService] Migrated ${migratedCount} items (${skippedTombstones} tombstones skipped)`
						);
					}
				}
			}

			// Delta Sync
			if (since) {
				const sinceDate = new Date(since);
				return millage.filter((m) => new Date(m.updatedAt || m.createdAt) > sinceDate);
			}

			// Sort by updatedAt/createdAt desc
			millage.sort((a, b) =>
				(b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
			);
			return millage;
		},

		async get(userId: string, id: string) {
			const all = await this.list(userId);
			return all.find((m) => m.id === id) || null;
		},

		async put(item: MillageRecord) {
			item.updatedAt = new Date().toISOString();
			delete item.deleted;

			// Write to KV
			await kv.put(`millage:${item.userId}:${item.id}`, JSON.stringify(item));

			// Update DO index
			const stub = getIndexStub(item.userId);
			try {
				await stub.fetch(`${DO_ORIGIN}/millage/put`, {
					method: 'POST',
					body: JSON.stringify(item)
				});
			} catch (err) {
				log.warn('[MillageService] Failed to update DO index', err);
			}
		},

		async delete(userId: string, id: string) {
			// Attempt direct key first
			let key = `millage:${userId}:${id}`;
			let raw = await kv.get(key);

			// If not found, try to locate the record using list/get fallbacks
			if (!raw) {
				const found = await this.get(userId, id);
				if (!found) return; // nothing to delete
				// Use the actual stored userId to construct the key
				key = `millage:${found.userId}:${id}`;
				raw = await kv.get(key);
				if (!raw) return;
			}

			const item = JSON.parse(raw);

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
				deletedBy: userId,
				metadata,
				backup: item,
				updatedAt: now.toISOString(),
				createdAt: item.createdAt
			};

			await kv.put(key, JSON.stringify(tombstone), {
				expirationTtl: RETENTION.THIRTY_DAYS
			});

			// Remove from DO index (use the user's DO stub from the stored userId to be safe)
			const stub = getIndexStub(item.userId);
			try {
				await stub.fetch(`${DO_ORIGIN}/millage/delete`, {
					method: 'POST',
					body: JSON.stringify({ id })
				});
			} catch (err) {
				log.warn('[MillageService] Failed to remove from DO index', err);
			}
		},

		async listTrash(userId: string) {
			const prefix = `millage:${userId}:`;
			let list = await kv.list({ prefix });
			let keys = list.keys;
			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}

			const out: TrashItem[] = [];
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				const parsed = JSON.parse(raw);
				if (!parsed || !parsed.deleted) continue;

				const id = parsed.id || String(k.name.split(':').pop() || '');
				const uid = parsed.userId || String(k.name.split(':')[1] || '');
				const metadata = parsed.metadata || {
					deletedAt: parsed.deletedAt || '',
					deletedBy: parsed.deletedBy || uid,
					originalKey: k.name,
					expiresAt: parsed.metadata?.expiresAt || ''
				};

				const backup = parsed.backup || parsed.data || parsed.millage || parsed || {};
				out.push({
					id,
					userId: uid,
					metadata,
					recordType: 'millage',
					date: (backup.date as string) || undefined,
					miles: typeof backup.miles === 'number' ? backup.miles : undefined,
					reimbursement:
						typeof backup.reimbursement === 'number' ? backup.reimbursement : undefined,
					vehicle: (backup.vehicle as string) || undefined
				});
			}

			out.sort((a, b) => (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || ''));
			return out;
		},

		async emptyTrash(userId: string) {
			const prefix = `millage:${userId}:`;
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
			const key = `millage:${userId}:${itemId}`;
			const raw = await kv.get(key);
			if (!raw) throw new Error('Item not found in trash');
			const parsed = JSON.parse(raw);
			if (!parsed || !parsed.deleted) throw new Error('Item is not deleted');
			const backup = parsed.backup || parsed.data || parsed.millage;
			if (!backup) throw new Error('Backup data not found in item');

			if ('deletedAt' in backup) delete (backup as Record<string, unknown>)['deletedAt'];
			if ('deleted' in backup) delete (backup as Record<string, unknown>)['deleted'];
			(backup as Record<string, unknown>)['updatedAt'] = new Date().toISOString();

			const restored = backup as MillageRecord;
			await kv.put(key, JSON.stringify(restored));

			// Restore in DO index
			const stub = getIndexStub(userId);
			try {
				await stub.fetch(`${DO_ORIGIN}/millage/put`, {
					method: 'POST',
					body: JSON.stringify(restored)
				});
			} catch (err) {
				log.warn('[MillageService] Failed to restore to DO index', err);
			}

			return restored;
		},

		async permanentDelete(userId: string, itemId: string) {
			const key = `millage:${userId}:${itemId}`;
			await kv.delete(key);

			// Remove from DO index as well
			const stub = getIndexStub(userId);
			try {
				await stub.fetch(`${DO_ORIGIN}/millage/delete`, {
					method: 'POST',
					body: JSON.stringify({ id: itemId })
				});
			} catch (err) {
				log.warn('[MillageService] Failed to remove from DO index during permanentDelete', err);
			}
		}
	};
}
