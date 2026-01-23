import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { toIsoDate, extractDateFromTs } from '$lib/server/hughesnet/utils';

import { getEnv, safeKV } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

type SessionUser = { id?: string; name?: string; token?: string };

// [SECURITY FIX] Limit imports to prevent OOM and unbounded processing
const MAX_IMPORT_BATCH = 500;

export const POST: RequestHandler = async ({ platform, locals, request }) => {
	// Use helper to normalize platform env access in type-checks
	const env = getEnv(platform);
	if (!env || !safeKV(env, 'BETA_HUGHESNET_ORDERS_KV') || !safeKV(env, 'BETA_HUGHESNET_KV')) {
		return json({ success: false, error: 'Orders KV or HNS KV not configured' }, { status: 500 });
	}

	const user = locals.user as SessionUser | undefined;
	// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
	const userId = getStorageId(user);
	try {
		const body = (await request.json()) as unknown;
		const bodyObj = body as Record<string, unknown>;
		const kv = safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')!;
		const hnsKV = safeKV(env, 'BETA_HUGHESNET_KV')!;

		let ids: string[] = [];
		if (bodyObj['all']) {
			const listRes = await kv.list({ prefix: 'hns:order:' });
			const keys = listRes.keys || [];
			for (const k of keys) {
				const raw = await kv.get(k.name);
				if (!raw) continue;
				try {
					const p = JSON.parse(raw);
					if (p && p.ownerId === userId && p.order && p.order.id) ids.push(String(p.order.id));
				} catch (err: unknown) {
					log.warn('Skipping corrupt archived order key during ids gather', {
						key: k.name,
						message: createSafeErrorMessage(err)
					});
				}
			}
		} else if (Array.isArray(bodyObj['ids'])) {
			ids = (bodyObj['ids'] as unknown[]).map(String);
		} else if (bodyObj['id']) {
			ids = [String(bodyObj['id'])];
		} else {
			return json({ success: false, error: 'No ids supplied' }, { status: 400 });
		}

		// [SECURITY FIX] Limit batch size to prevent OOM/timeouts
		const wasTruncated = ids.length > MAX_IMPORT_BATCH;
		if (wasTruncated) {
			ids = ids.slice(0, MAX_IMPORT_BATCH);
		}

		// Load user's HNS DB
		let orderDb: Record<string, unknown> = {};
		const dbRaw = await hnsKV.get(`hns:db:${userId}`);
		if (dbRaw) {
			try {
				orderDb = JSON.parse(dbRaw);
			} catch (err: unknown) {
				log.warn('Failed to parse hns db for user', {
					userId,
					message: createSafeErrorMessage(err)
				});
				orderDb = {};
			}
		}

		const imported: string[] = [];
		const skipped: string[] = [];
		const importedDates: string[] = [];

		for (const id of ids) {
			try {
				const raw = await kv.get(`hns:order:${id}`);
				if (!raw) {
					skipped.push(id);
					continue;
				}
				let wrapper;
				try {
					wrapper = JSON.parse(raw);
				} catch (err: unknown) {
					skipped.push(id);
					log.warn('Skipping corrupt archived order during import', {
						id,
						message: createSafeErrorMessage(err)
					});
					continue;
				}
				if (!wrapper || wrapper.ownerId !== userId || !wrapper.order) {
					skipped.push(id);
					continue;
				}
				if ((orderDb[id] as Record<string, unknown> | undefined)?.['address']) {
					skipped.push(id);
					continue;
				}
				const order = {
					...(wrapper.order as Record<string, unknown>),
					restoredFromArchive: true,
					lastSyncTimestamp: Date.now()
				};
				orderDb[id] = order;
				imported.push(id);

				// Compute import date (ISO) for trip sync
				const ord = order as Record<string, unknown>;
				const iso =
					(typeof ord['confirmScheduleDate'] === 'string' &&
						toIsoDate(ord['confirmScheduleDate'] as string)) ||
					(typeof ord['arrivalTimestamp'] === 'number' &&
						extractDateFromTs(ord['arrivalTimestamp'] as number));
				if (iso) importedDates.push(iso as string);
			} catch (err: unknown) {
				skipped.push(id);
				log.warn('Failed to import archived order', { id, message: createSafeErrorMessage(err) });
			}
		}

		if (imported.length > 0) {
			await hnsKV.put(`hns:db:${userId}`, JSON.stringify(orderDb));
		}

		// Deduplicate dates
		const uniqueDates = Array.from(new Set(importedDates));

		return json({
			success: true,
			imported,
			skipped,
			importedDates: uniqueDates,
			...(wasTruncated && { truncated: true, maxBatch: MAX_IMPORT_BATCH })
		});
	} catch (err: unknown) {
		return json({ success: false, error: createSafeErrorMessage(err) }, { status: 500 });
	}
};
