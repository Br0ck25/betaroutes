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
	startOdometer: z.number().nonnegative().optional(),
	endOdometer: z.number().nonnegative().optional(),
	notes: z.string().max(1000).optional(),
	miles: z.number().nonnegative().optional(),
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

		// Capture 'since' for differential sync
		const since = event.url.searchParams.get('since') || undefined;

		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const userId = getStorageId(user);

		// Use service list logic which handles KV/DO fallback and syncing logic
		const items = await svc.list(userId, since);

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
		const userId = getStorageId(sessionUser);

		let miles =
			typeof payload.miles === 'number'
				? payload.miles
				: Math.max(0, Number(payload.endOdometer) - Number(payload.startOdometer));
		miles = Number(miles.toFixed(2));

		let reimbursement = payload.reimbursement ?? undefined;
		if (typeof reimbursement === 'number') reimbursement = Number(reimbursement.toFixed(2));

		// If reimbursement not provided, compute using provided rate or user's default rate from settings
		if (typeof reimbursement !== 'number') {
			let rate: number | undefined =
				typeof payload.millageRate === 'number' ? Number(payload.millageRate) : undefined;
			if (rate == null) {
				try {
					const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
					if (userSettingsKV) {
						const raw = await userSettingsKV.get(`settings:${userId}`);
						if (raw) {
							const parsed = JSON.parse(raw as string);
							rate = parsed?.millageRate;
						}
					}
				} catch (e) {
					/* ignore */
				}
			}
			if (typeof rate === 'number') reimbursement = Number((miles * rate).toFixed(2));
		}

		// Build authoritative millage record
		const record: any = {
			id,
			userId,
			date: payload.date || new Date().toISOString(),
			startOdometer: typeof payload.startOdometer === 'number' ? payload.startOdometer : undefined,
			endOdometer: typeof payload.endOdometer === 'number' ? payload.endOdometer : undefined,
			miles: typeof miles === 'number' ? Number(miles) : undefined,
			millageRate:
				typeof payload.millageRate === 'number' ? Number(payload.millageRate) : undefined,
			vehicle: payload.vehicle === '' ? undefined : payload.vehicle,
			reimbursement: typeof reimbursement === 'number' ? Number(reimbursement) : undefined,
			notes: payload.notes || '',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		await svc.put(record);

		return new Response(JSON.stringify(record), {
			headers: { 'Content-Type': 'application/json' },
			status: 201
		});
	} catch (err) {
		log.error('POST /api/millage error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
