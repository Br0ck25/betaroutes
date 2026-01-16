// src/lib/server/millageService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
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

export function makeMillageService(kv: KVNamespace, trashKV?: KVNamespace) {
	return {
		async list(userId: string): Promise<MillageRecord[]> {
			const prefix = `millage:${userId}:`;
			let list = await kv.list({ prefix });
			let keys = list.keys;

			while (!list.list_complete && list.cursor) {
				list = await kv.list({ prefix, cursor: list.cursor });
				keys = keys.concat(list.keys);
			}

			const items: MillageRecord[] = [];
			for (const key of keys) {
				const raw = await kv.get(key.name);
				if (!raw) continue;
				try {
					items.push(JSON.parse(raw));
				} catch {
					log.warn('[MillageService] Failed to parse record', { key: key.name });
				}
			}

			// Sort by createdAt desc
			items.sort(
				(a, b) =>
					new Date(b.createdAt || b.updatedAt).getTime() -
					new Date(a.createdAt || a.updatedAt).getTime()
			);
			return items;
		},

		async get(userId: string, id: string) {
			const raw = await kv.get(`millage:${userId}:${id}`);
			return raw ? (JSON.parse(raw) as MillageRecord) : null;
		},

		async put(item: MillageRecord) {
			item.updatedAt = new Date().toISOString();
			delete item.deleted;
			await kv.put(`millage:${item.userId}:${item.id}`, JSON.stringify(item));
		},

		async delete(userId: string, id: string) {
			const raw = await kv.get(`millage:${userId}:${id}`);
			if (!raw) return;
			const item = JSON.parse(raw);

			const now = new Date();
			const expiresAt = new Date(now.getTime() + RETENTION.THIRTY_DAYS * 1000);

			const metadata = {
				deletedAt: now.toISOString(),
				deletedBy: userId,
				originalKey: `millage:${userId}:${id}`,
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

			await kv.put(`millage:${userId}:${id}`, JSON.stringify(tombstone), {
				expirationTtl: RETENTION.THIRTY_DAYS
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

			const out: any[] = [];
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
			return restored;
		},

		async permanentDelete(userId: string, itemId: string) {
			const key = `millage:${userId}:${itemId}`;
			await kv.delete(key);
		}
	};
}
