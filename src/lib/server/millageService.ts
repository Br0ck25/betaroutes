// src/lib/server/millageService.ts
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
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

			// Delta Sync: Return everything (including deletions)
			if (since) {
				const sinceDate = new Date(since);
				return millage.filter((m) => new Date(m.updatedAt || m.createdAt) > sinceDate);
			}

			// [!code fix] Full List: Filter out deleted items (Tombstones)
			// This prevents deleted items from appearing on page load/refresh
			return millage
				.filter((m) => !m.deleted)
				.sort((a, b) =>
					(b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
				);
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

			// Write to DO
			const stub = getIndexStub(item.userId);
			await stub.fetch(`${DO_ORIGIN}/millage/put`, {
				method: 'POST',
				body: JSON.stringify(item)
			});
		},

		async delete(userId: string, id: string) {
			const stub = getIndexStub(userId);

			const key = `millage:${userId}:${id}`;
			const raw = await kv.get(key);
			if (!raw) return;

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
			await stub.fetch(`${DO_ORIGIN}/millage/put`, {
				method: 'POST',
				body: JSON.stringify(tombstone)
			});
		},

		async listTrash(userId: string) {
			const prefix = `millage:${userId}:`;
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
					recordType: 'millage',
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
			const key = `millage:${userId}:${itemId}`;
			await kv.delete(key);

			const stub = getIndexStub(userId);
			await stub.fetch(`${DO_ORIGIN}/millage/delete`, {
				method: 'POST',
				body: JSON.stringify({ id: itemId })
			});
		},

		async restore(userId: string, itemId: string) {
			const key = `millage:${userId}:${itemId}`;
			const raw = await kv.get(key);
			if (!raw) throw new Error('Item not found');

			const tombstone = JSON.parse(raw);
			if (!tombstone.deleted) throw new Error('Item not deleted');

			const restored = tombstone.backup || tombstone.data || tombstone;
			delete restored.deleted;
			delete restored.deletedAt;
			delete restored.metadata;
			delete restored.backup;
			restored.updatedAt = new Date().toISOString();

			await this.put(restored);
			return restored;
		}
	};
}
