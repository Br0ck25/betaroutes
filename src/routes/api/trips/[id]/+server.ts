// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

// Helper to safely get KV namespace
function safeKV(env: any, name: string) {
	const kv = env?.[name];
	if (!kv) {
		console.warn(`[API] KV Binding '${name}' not found.`);
	}
	return kv ?? null;
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
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = event.platform?.env?.TRIP_INDEX_DO ?? fakeDO();
		
		// [!code fix] Pass DO to service
		const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO);

		const storageId = user.name || user.token;

		const trip = await svc.get(storageId, id);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('GET /api/trips/[id] error', err);
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
		const body = await event.request.json();

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = event.platform?.env?.TRIP_INDEX_DO ?? fakeDO();
		
		// [!code fix] Pass DO to service
		const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO);

		const storageId = user.name || user.token;

		// Verify existing ownership
		const existing = await svc.get(storageId, id);
		if (!existing) {
			return new Response('Not Found', { status: 404 });
		}

		const updated = {
			...existing,
			...body,
			id,
			userId: storageId,
			updatedAt: new Date().toISOString()
		};

		await svc.put(updated);

		return new Response(JSON.stringify(updated), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('PUT /api/trips/[id] error', err);
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
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] Get DO binding
		const tripIndexDO = event.platform?.env?.TRIP_INDEX_DO ?? fakeDO();
		
		// [!code fix] Pass DO to service
		const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO);

		const storageId = user.name || user.token;

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

		await svc.incrementUserCounter(user.token, -1);

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('DELETE /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};