// src/routes/api/millage/+server.ts
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { makeMillageService } from '$lib/server/millageService';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

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

		const storageId = user.name || user.token || user.id || '';
		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!);
		const items = await svc.list(storageId);
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
		const userId = sessionUser.name || sessionUser.token || sessionUser.id || '';
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

		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!);
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
