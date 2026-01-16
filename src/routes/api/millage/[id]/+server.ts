// src/routes/api/millage/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeMillageService } from '$lib/server/millageService';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

export const DELETE: RequestHandler = async (event) => {
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

		const id = event.params.id;
		const userId = sessionUser.name || sessionUser.token || sessionUser.id || '';
		const svc = makeMillageService(
			safeKV(env, 'BETA_MILLAGE_KV')!,
			safeKV(env, 'BETA_MILLAGE_TRASH_KV')
		);
		await svc.delete(userId, id);
		return new Response(null, { status: 204 });
	} catch (err) {
		log.error('DELETE /api/millage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const GET: RequestHandler = async (event) => {
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

		const id = event.params.id;
		const userId = sessionUser.name || sessionUser.token || sessionUser.id || '';
		const svc = makeMillageService(
			safeKV(env, 'BETA_MILLAGE_KV')!,
			safeKV(env, 'BETA_MILLAGE_TRASH_KV')
		);
		const item = await svc.get(userId, id);
		if (!item) return new Response('Not found', { status: 404 });
		return new Response(JSON.stringify(item), { headers: { 'Content-Type': 'application/json' } });
	} catch (err) {
		log.error('GET /api/millage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
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

		const id = event.params.id;
		const userId = sessionUser.name || sessionUser.token || sessionUser.id || '';
		const body = (await event.request.json()) as any;

		const svc = makeMillageService(
			safeKV(env, 'BETA_MILLAGE_KV')!,
			safeKV(env, 'BETA_MILLAGE_TRASH_KV')
		);
		const existing = await svc.get(userId, id);
		if (!existing) return new Response('Not found', { status: 404 });

		const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
		if (typeof updated.startOdometer === 'number' && typeof updated.endOdometer === 'number') {
			updated.miles = Math.max(0, updated.endOdometer - updated.startOdometer);
			updated.miles = Number((updated.miles || 0).toFixed(2));
		}

		if (typeof updated.reimbursement === 'number') {
			updated.reimbursement = Number(updated.reimbursement.toFixed(2));
		}

		if (typeof updated.millageRate === 'number') {
			updated.millageRate = Number(updated.millageRate);
		}

		if (updated.vehicle === '') updated.vehicle = undefined;

		await svc.put(updated);
		return new Response(JSON.stringify(updated), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/millage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
