// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeMillageService, type MillageRecord } from '$lib/server/millageService';
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

		const userSafe = user as { name?: string; token?: string } | undefined;
		const storageId = userSafe?.name || userSafe?.token || '';

		const trip = await svc.get(storageId, id);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
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

		const userSafe = user as { name?: string; token?: string } | undefined;
		const storageId = userSafe?.name || userSafe?.token || '';

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

		const userSafe = user as { name?: string; token?: string } | undefined;
		const storageId = userSafe?.name || userSafe?.token || '';

		// Check if trip exists
		const existing = await svc.get(storageId, id);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Perform soft delete
		await svc.delete(storageId, id);

		// --- Cascade delete: Delete linked mileage log ---
		try {
			const millageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
			if (millageKV) {
				const millageSvc = makeMillageService(
					millageKV as unknown as KVNamespace,
					tripIndexDO as unknown as DurableObjectNamespace
				);
				// Find mileage logs linked to this trip
				const allMillage = await millageSvc.list(storageId);
				const linkedMillage = allMillage.filter((m: MillageRecord) => m.tripId === id);
				for (const m of linkedMillage) {
					await millageSvc.delete(storageId, m.id);
					log.info('Cascade deleted mileage log for trip', { tripId: id, millageId: m.id });
				}
			}
		} catch (e) {
			log.warn('Failed to cascade delete mileage logs', { tripId: id, message: createSafeErrorMessage(e) });
		}

		await svc.incrementUserCounter(userSafe?.token ?? '', -1);

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
