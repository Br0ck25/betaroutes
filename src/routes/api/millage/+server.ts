// src/routes/api/millage/+server.ts
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { makeMillageService } from '$lib/server/millageService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { getStorageId } from '$lib/server/user';

const millageSchema = z.object({
	id: z.string().uuid().optional(),
	date: z.string().optional(),
	startOdometer: z.number().nonnegative(),
	endOdometer: z.number().nonnegative(),
	notes: z.string().max(1000).optional(),
	miles: z.number().nonnegative().optional(),
	// Optional per-log millage rate and vehicle
	millageRate: z.number().nonnegative().optional(),
	vehicle: z.string().optional(),
	reimbursement: z.number().nonnegative().optional()
});

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as { id?: string; name?: string; token?: string } | undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		let env: any;
		try {
			env = getEnv(event.platform as any);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		// Try canonical identifiers (id first) but also fall back to token or name if data was stored under those
		const since = event.url.searchParams.get('since') || undefined;
		const possibleIds = Array.from(
			new Set([user.id, user.token, user.name].filter(Boolean))
		) as string[];
		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Merge results from each possible storage id and dedupe by record id
		const map = new Map<string, any>();
		for (const idKey of possibleIds) {
			const list = await svc.list(idKey, since);
			for (const it of list) {
				const existing = map.get(it.id);
				if (!existing) map.set(it.id, it);
				else {
					// Keep the most recently-updated record
					const a = existing.updatedAt || existing.createdAt || '';
					const b = it.updatedAt || it.createdAt || '';
					if (new Date(b) > new Date(a)) map.set(it.id, it);
				}
			}
		}

		let items = Array.from(map.values()).sort((a, b) =>
			(b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
		);

		// Fallback: if nothing found under the known identifiers, scan all millage keys and
		// include records whose embedded userId matches this user. This helps find items
		// that were created under a different session identifier (e.g., token-based keying).
		if (items.length === 0) {
			const kvNs = safeKV(env, 'BETA_MILLAGE_KV')! as any;
			let list = await kvNs.list({ prefix: 'millage:' });
			let keys = list.keys;
			while (!list.list_complete && list.cursor) {
				list = await kvNs.list({ prefix: 'millage:', cursor: list.cursor });
				keys = keys.concat(list.keys);
			}

			const matched: any[] = [];
			for (const k of keys) {
				const raw = await kvNs.get(k.name);
				if (!raw) continue;
				let parsed: any;
				try {
					parsed = JSON.parse(raw);
				} catch {
					continue;
				}
				const uid = parsed.userId || k.name.split(':')[1] || '';
				if ([user.id, user.token, user.name].includes(uid)) {
					matched.push(parsed);
				}
			}

			items = matched.sort((a: any, b: any) =>
				(b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
			);
		}

		return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
	} catch (err) {
		log.error('GET /api/millage error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user as
			| { id?: string; name?: string; token?: string }
			| undefined;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		let env: any;
		try {
			env = getEnv(event.platform as any);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		const raw = (await event.request.json()) as unknown;
		const parse = millageSchema.safeParse(raw);
		if (!parse.success) {
			return new Response(JSON.stringify({ error: 'Invalid Data' }), { status: 400 });
		}

		const payload = parse.data;
		const id = payload.id || crypto.randomUUID();
		// Key millage records by the username (preferred), then fall back to id or token
		const userId = getStorageId(sessionUser);
		let miles =
			typeof payload.miles === 'number'
				? payload.miles
				: Math.max(0, Number(payload.endOdometer) - Number(payload.startOdometer));
		// Round miles to 2 decimals for storage/display
		miles = Number(miles.toFixed(2));

		let reimbursement = payload.reimbursement ?? undefined;
		if (typeof reimbursement === 'number') reimbursement = Number(reimbursement.toFixed(2));

		const record = {
			id,
			userId,
			date: payload.date || new Date().toISOString(),
			startOdometer: payload.startOdometer,
			endOdometer: payload.endOdometer,
			miles,
			millageRate:
				typeof payload.millageRate === 'number' ? Number(payload.millageRate) : undefined,
			vehicle: payload.vehicle || undefined,
			reimbursement,
			notes: payload.notes || '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		await svc.put(record as any);

		return new Response(JSON.stringify(record), {
			status: 201,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('POST /api/millage error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
