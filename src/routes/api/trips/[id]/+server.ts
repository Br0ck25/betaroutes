// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

// Consistent environment getter
function getEnv(platform: any) {
    const env = platform?.env;
    if (platform && (!env?.BETA_LOGS_KV || !env?.TRIP_INDEX_DO)) {
        throw new Error('CRITICAL: Database bindings missing in production');
    }
    if (!env?.BETA_LOGS_KV) {
        return {
            kv: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            trashKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            placesKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            tripIndexDO: { idFromName: () => ({ name: 'fake' }), get: () => ({ fetch: async () => new Response(JSON.stringify([])) }) }
        };
    }
    return {
        kv: env.BETA_LOGS_KV,
        trashKV: env.BETA_LOGS_TRASH_KV,
        placesKV: env.BETA_PLACES_KV,
        tripIndexDO: env.TRIP_INDEX_DO
    };
}

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }

		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);

		// [!code fix] Use Immutable ID
		const storageId = user.id;

		const trip = await svc.get(storageId, id);
		if (!trip) return new Response('Not Found', { status: 404 });

		return new Response(JSON.stringify(trip), { status: 200 });
	} catch (err) {
		console.error('GET /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const body = await event.request.json();

        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }

		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);
		
        // [!code fix] Use Immutable ID
        const storageId = user.id;

		const existing = await svc.get(storageId, id);
		if (!existing) return new Response('Not Found', { status: 404 });

		const updated = {
			...existing,
			...body,
			id,
			userId: storageId,
			updatedAt: new Date().toISOString()
		};

		await svc.put(updated);

		return new Response(JSON.stringify(updated), { status: 200 });
	} catch (err) {
		console.error('PUT /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }

		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);
		
        // [!code fix] Use Immutable ID
        const storageId = user.id;

		const existing = await svc.get(storageId, id);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
		}

		await svc.delete(storageId, id);
		await svc.incrementUserCounter(user.token, -1);

		return new Response(JSON.stringify({ success: true }), { status: 200 });
	} catch (err) {
		console.error('DELETE /api/trips/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};