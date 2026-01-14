// src/lib/server/millageService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
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

			if (trashKV) {
				const now = new Date();
				const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
				const metadata = {
					deletedAt: now.toISOString(),
					deletedBy: userId,
					originalKey: `millage:${userId}:${id}`,
					expiresAt: expiresAt.toISOString()
				};
				const trashItem = { type: 'millage', data: item, metadata };
				await trashKV.put(`trash:${userId}:${id}`, JSON.stringify(trashItem), {
					expirationTtl: 30 * 24 * 60 * 60
				});
			}

			await kv.delete(`millage:${userId}:${id}`);
		}
	};
}
