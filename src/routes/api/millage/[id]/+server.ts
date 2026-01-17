// src/routes/api/millage/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeMillageService } from '$lib/server/millageService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { getStorageId } from '$lib/server/user';

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
		const userId = getStorageId(sessionUser);
		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);

		// Soft delete via service
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
		const userId = getStorageId(sessionUser);
		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
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
		const userId = getStorageId(sessionUser);

		const svc = makeMillageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const existing = await svc.get(userId, id);
		if (!existing) return new Response('Not found', { status: 404 });

		const body: any = await event.request.json();

		// Merge existing with update
		const updated = {
			...existing,
			...body,
			userId, // Ensure userId cannot be changed
			id, // Ensure ID cannot be changed
			updatedAt: new Date().toISOString()
		};

		// Re-calculate fields if inputs changed — but respect an explicitly provided `miles`.
		const bodyHasMiles = Object.prototype.hasOwnProperty.call(body, 'miles');

		if (
			!bodyHasMiles &&
			typeof updated.startOdometer === 'number' &&
			typeof updated.endOdometer === 'number'
		) {
			updated.miles = Math.max(0, updated.endOdometer - updated.startOdometer);
			updated.miles = Number((updated.miles || 0).toFixed(2));
		} else if (bodyHasMiles && typeof updated.miles === 'number') {
			// Respect and normalize an explicitly provided miles value
			updated.miles = Number(updated.miles.toFixed(2));
		}

		// Recompute reimbursement when appropriate (respect explicit `reimbursement`)
		const bodyHasReimbursement = Object.prototype.hasOwnProperty.call(body, 'reimbursement');
		if (!bodyHasReimbursement && typeof updated.miles === 'number') {
			let rate = typeof updated.millageRate === 'number' ? updated.millageRate : undefined;
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
				} catch {
					/* ignore */
				}
			}
			if (typeof rate === 'number')
				updated.reimbursement = Number((updated.miles * rate).toFixed(2));
		}

		if (typeof updated.reimbursement === 'number') {
			updated.reimbursement = Number(updated.reimbursement.toFixed(2));
		}

		if (typeof updated.millageRate === 'number') {
			updated.millageRate = Number(updated.millageRate);
		}

		if (updated.vehicle === '') updated.vehicle = undefined;

		// Persist authoritative millage
		await svc.put(updated);

		// Best-effort: mirror `miles` into the trip record stored in BETA_LOGS_KV so
		// trips remain discoverable/consistent in the original trip logs KV.
		try {
			const tripKV = safeKV(env, 'BETA_LOGS_KV');
			if (tripKV) {
				const { makeTripService } = await import('$lib/server/tripService');
				const tripSvc = makeTripService(
					tripKV as any,
					undefined,
					undefined,
					safeDO(env, 'TRIP_INDEX_DO')! as any,
					safeDO(env, 'PLACES_INDEX_DO')! as any
				);
				const existingTrip = await tripSvc.get(getStorageId(sessionUser), id);
				if (existingTrip && typeof updated.miles === 'number') {
					const patched = {
						...existingTrip,
						totalMiles: updated.miles,
						updatedAt: new Date().toISOString()
					} as any;
					// best-effort write; do not fail the millage update if this fails
					await tripSvc.put(patched).catch((err: unknown) => {
						log.warn('Failed to mirror millage into trip KV (non-fatal):', String(err));
						return null;
					});
				}
			}
		} catch (err) {
			log.warn('Failed to mirror millage to trips KV (non-fatal):', String(err));
		}

		return new Response(JSON.stringify(updated), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/millage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
