// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

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

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }
		
		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);

		// [!code fix] Use Immutable ID
		const storageId = user.id;
		const restoredTrip = await svc.restore(storageId, id);

		await svc.incrementUserCounter(user.token, 1);

		return new Response(JSON.stringify(restoredTrip), { status: 200 });
	} catch (err) {
		console.error('POST /api/trash/[id]/restore error', err);
		const message = err instanceof Error ? err.message : 'Internal Server Error';
		const status = message.includes('not found') ? 404 : 500;
		return new Response(JSON.stringify({ error: message }), { status });
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
		await svc.permanentDelete(storageId, id);

		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('DELETE /api/trash/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};