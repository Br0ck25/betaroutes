// src/routes/api/hughesnet/archived/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeKV } from '$lib/server/env';
import { getStorageId } from '$lib/server/user';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

type SessionUser = { id?: string; name?: string; token?: string };

export const GET: RequestHandler = async ({ platform, locals, url }) => {
	const env = getEnv(platform);
	const ordersKV = safeKV(env, 'BETA_HUGHESNET_ORDERS_KV');
	if (!ordersKV) {
		return json({ success: false, error: 'Orders KV not configured' }, { status: 500 });
	}

	const user = locals.user as SessionUser | undefined;
	// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
	const userId = getStorageId(user);
	const id = url.searchParams.get('id');

	try {
		const kv = ordersKV;

		if (id) {
			// First, check the Orders KV for an archived record
			const raw = await kv.get(`hns:order:${id}`);
			if (raw) {
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch (err: unknown) {
					log.warn('Corrupt archived record', { id, message: createSafeErrorMessage(err) });
					return json({ success: false, error: 'Corrupt record' }, { status: 500 });
				}
				if (parsed.ownerId !== userId)
					return json({ success: false, error: 'Not found' }, { status: 404 });
				return json({ success: true, order: parsed.order });
			}

			// If not found in Orders KV, check the per-user HNS DB as a fallback
			const hnsKV = safeKV(env, 'BETA_HUGHESNET_KV');
			if (hnsKV) {
				try {
					const dbRaw = await hnsKV.get(`hns:db:${userId}`);
					if (dbRaw) {
						const db = JSON.parse(dbRaw) as Record<string, unknown>;
						if (db && Object.prototype.hasOwnProperty.call(db, id)) {
							return json({ success: true, order: db[id] });
						}
					}
				} catch (err: unknown) {
					log.warn('Failed to read user HNS DB as archived fallback', {
						id,
						message: createSafeErrorMessage(err)
					});
				}
			}

			return json({ success: false, error: 'Not found' }, { status: 404 });
		}

		// list all keys and return those owned by the current user
		const listRes = await kv.list({ prefix: 'hns:order:' });
		const keys = listRes.keys || [];
		const results: Array<{ id: string; storedAt?: number; order: unknown }> = [];
		for (const k of keys) {
			const raw = await kv.get(k.name);
			if (!raw) continue;
			try {
				const p = JSON.parse(raw);
				if (p && p.ownerId === userId && p.order) {
					results.push({
						id: k.name.replace(/^hns:order:/, ''),
						storedAt: p.storedAt,
						order: p.order
					});
				}
			} catch (err: unknown) {
				log.warn('Skipping corrupt archived record', {
					key: k.name,
					message: createSafeErrorMessage(err)
				});
			}
		}

		// Also include orders present in the user's HNS DB (hns:db) that may not have been persisted to Orders KV yet
		try {
			const hnsKV = safeKV(env, 'BETA_HUGHESNET_KV');
			if (hnsKV) {
				const dbRaw = await hnsKV.get(`hns:db:${userId}`);
				if (dbRaw) {
					const db = JSON.parse(dbRaw) as Record<string, any>;
					for (const [oid, order] of Object.entries(db)) {
						if (!results.some((r) => r.id === oid)) {
							results.push({ id: oid, storedAt: undefined, order });
						}
					}
				}
			}
		} catch (err: unknown) {
			log.warn('Failed to include HNS DB orders in archived list', {
				message: createSafeErrorMessage(err)
			});
		}

		return json({ success: true, orders: results });
	} catch (err: unknown) {
		return json({ success: false, error: createSafeErrorMessage(err) }, { status: 500 });
	}
};

// Development helper: Insert a test archived order for the authenticated user
export const POST: RequestHandler = async ({ platform, locals, request }) => {
	// Only allow when explicitly enabled via env var to avoid accidental writes in production
	const env = getEnv(platform);
	const ordersKV = safeKV(env, 'BETA_HUGHESNET_ORDERS_KV');
	if (!ordersKV) {
		return json({ success: false, error: 'Orders KV not configured' }, { status: 500 });
	}

	const allowInsert =
		env['ALLOW_HNS_ARCHIVE_INSERT'] === 'true' ||
		process.env['ALLOW_HNS_ARCHIVE_INSERT'] === 'true';
	if (!allowInsert) return json({ success: false, error: 'Not allowed' }, { status: 403 });

	const user = locals.user as SessionUser | undefined;
	// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
	const userId = getStorageId(user);

	try {
		const body = (await request.json()) as unknown;
		const bodyObj = body as Record<string, unknown>;
		const id = String(bodyObj['id'] || `dev_${Date.now()}`);
		const order = (bodyObj['order'] as unknown) || {
			id,
			address: String(bodyObj['address'] || 'Dev Inserted Address')
		};
		const kv = ordersKV;
		await kv.put(
			`hns:order:${id}`,
			JSON.stringify({ ownerId: userId, storedAt: Date.now(), order })
		);
		return json({ success: true, id });
	} catch (err: unknown) {
		return json({ success: false, error: createSafeErrorMessage(err) }, { status: 500 });
	}
};
