// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import type { TripRecord } from '$lib/server/tripService';
import { log } from '$lib/server/log';
import { safeDO } from '$lib/server/env';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

// Helper to safely get KV namespace
function safeKV(env: unknown, name: string) {
	const bindings = env as Record<string, unknown> | undefined;
	const kv = bindings?.[name];
	if (!kv) {
		log.warn(`[API] KV Binding '${name}' not found.`);
	}
	return kv ?? undefined;
}

// [!code ++] Helper for fake Durable Object (Fallback)
function fakeDO() {
	return {
		idFromName: () => ({ name: 'fake' }),
		get: () => ({
			fetch: async () => new Response(JSON.stringify([]))
		})
	};
}

/**
 * GET /api/trips/[id] - Retrieve a single trip
 */
export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

		// Connect to KVs
		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO') ?? fakeDO();
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service (add placesIndexDO)
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const storageId = user.id;

		const trip = await svc.get(storageId, id);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		// Prefer authoritative mileage from BETA_MILLAGE_KV (merge if present)
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV as any,
					safeDO(event.platform?.env, 'TRIP_INDEX_DO')!
				);
				const m = await mileageSvc.get(storageId, id);
				if (m && typeof m.miles === 'number') trip.totalMiles = m.miles;
			}
		} catch (err) {
			log.warn('Failed to merge mileage into trip response', { tripId: id, err });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('GET /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

/**
 * PUT /api/trips/[id] - Update a trip
 */
export const PUT: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const body = (await event.request.json()) as Record<string, unknown>;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO') ?? fakeDO();
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service (add placesIndexDO)
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const storageId = user.id;

		// Verify existing ownership
		const existing = await svc.get(storageId, id);
		if (!existing) {
			return new Response('Not Found', { status: 404 });
		}

		const updated = {
			...(existing as Record<string, unknown>),
			...(body as Record<string, unknown>),
			id,
			userId: storageId,
			updatedAt: new Date().toISOString()
		};

		await svc.put(updated as unknown as TripRecord);

		// If client edited totalMiles, persist authoritative mileage to its own KV so updates propagate to other clients
		try {
			if (Object.prototype.hasOwnProperty.call(body, 'totalMiles')) {
				const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
				if (mileageKV) {
					const mileageSvc = makeMileageService(
						mileageKV as any,
						safeDO(event.platform?.env, 'TRIP_INDEX_DO')!
					);
					const mileageRec = {
						id,
						userId: storageId,
						date: (body['date'] as string) || (existing as any).date || new Date().toISOString(),
						startOdometer: 0,
						endOdometer: 0,
						miles: Number((body as any).totalMiles) || 0,
						createdAt: (existing as any).createdAt || new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const p = mileageSvc
						.put(mileageRec as any)
						.catch((err) => log.warn('mileage.put failed for trip update', { tripId: id, err }));
					try {
						if (event.platform?.context?.waitUntil) event.platform.context.waitUntil(p as any);
						else if ((event as any)?.context?.waitUntil) (event as any).context.waitUntil(p);
					} catch {
						void p;
					}
				}
			}
		} catch (err) {
			log.warn('Failed to persist mileage for trip update', {
				tripId: id,
				message: createSafeErrorMessage(err)
			});
		}

		return new Response(JSON.stringify(updated), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

/**
 * DELETE /api/trips/[id] - Soft delete trip (move to trash)
 */
export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO') ?? fakeDO();
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const storageId = user.id;

		// Check if trip exists
		const existing = await svc.get(storageId, id);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// If trip is already deleted (tombstone), return success (idempotent)
		if (existing.deleted) {
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Perform soft delete
		await svc.delete(storageId, id);

		// --- Cascade delete: Delete linked mileage logs (marked as cascade deleted) ---
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV as unknown as KVNamespace,
					tripIndexDO as unknown as DurableObjectNamespace
				);
				// Find mileage logs linked to this trip
				// Mileage logs can be linked by tripId OR by having the same id as the trip
				const allMileage = await mileageSvc.list(storageId);
				const linkedMileage = allMileage.filter(
					(m: MileageRecord) => m.tripId === id || m.id === id
				);
				for (const m of linkedMileage) {
					// Pass cascadeDeleted: true so these don't show in trash UI
					await mileageSvc.delete(storageId, m.id, { cascadeDeleted: true });
					log.info('Cascade deleted mileage log for trip', { tripId: id, mileageId: m.id });
				}
			}
		} catch (e) {
			log.warn('Failed to cascade delete mileage logs', {
				tripId: id,
				message: createSafeErrorMessage(e)
			});
		}

		// --- Cascade delete: Delete linked expense logs (marked as cascade deleted) ---
		try {
			const expenseKV = safeKV(event.platform?.env, 'BETA_EXPENSES_KV');
			if (expenseKV) {
				const expenseSvc = makeExpenseService(
					expenseKV as unknown as KVNamespace,
					tripIndexDO as unknown as DurableObjectNamespace
				);
				// Find expenses linked to this trip by tripId
				const allExpenses = await expenseSvc.list(storageId);
				const linkedExpenses = allExpenses.filter(
					(e: ExpenseRecord) => (e as { tripId?: string }).tripId === id
				);
				for (const e of linkedExpenses) {
					// Pass cascadeDeleted: true so these don't show in trash UI
					await expenseSvc.delete(storageId, e.id, { cascadeDeleted: true });
					log.info('Cascade deleted expense log for trip', { tripId: id, expenseId: e.id });
				}
			}
		} catch (e) {
			log.warn('Failed to cascade delete expense logs', {
				tripId: id,
				message: createSafeErrorMessage(e)
			});
		}

		await svc.incrementUserCounter(user.token ?? '', -1);

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('DELETE /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
