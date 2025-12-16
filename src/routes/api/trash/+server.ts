// src/routes/api/trash/+server.ts
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

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }
		
		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);

		// [!code fix] Use Immutable ID
		const storageId = user.id;
		const cloudTrash = await svc.listTrash(storageId);

		return new Response(JSON.stringify(cloudTrash), { status: 200 });
	} catch (err) {
		console.error('GET /api/trash error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

        let env;
        try { env = getEnv(event.platform); } catch (e) { return new Response('Service Unavailable', { status: 503 }); }
		
		const svc = makeTripService(env.kv, env.trashKV, env.placesKV, env.tripIndexDO);

		// [!code fix] Use Immutable ID
		const storageId = user.id;
		const deleted = await svc.emptyTrash(storageId);

		return new Response(
			JSON.stringify({
				deleted,
				message: `${deleted} cloud trash items permanently removed`
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	} catch (err) {
		console.error('DELETE /api/trash error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};