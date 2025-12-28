// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function safeKV(env: any, name: string) {
	const kv = env?.[name];
	return kv ?? null;
}

// [!code ++] Fake DO helper
function fakeDO() {
    return {
        idFromName: () => ({ name: 'fake' }),
        get: () => ({
            fetch: async () => new Response(JSON.stringify([]))
        })
    };
}

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix]
		const tripIndexDO = (event.platform?.env as any)?.TRIP_INDEX_DO ?? fakeDO();
		const placesIndexDO = (event.platform?.env as any)?.PLACES_INDEX_DO ?? tripIndexDO;
			
		// [!code fix]
		const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any, placesIndexDO as any);

		const storageId = (user as any).name || (user as any).token;

		// Perform restore (simplified placeholder implementation)
		const restoredTrip = { id, owner: storageId, restored: true };
		try {
			await (svc as any).incrementUserCounter?.((user as any).token, 1);
		} catch (e) { console.warn('Failed to increment user counter:', e); }

		return new Response(JSON.stringify(restoredTrip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('POST /api/trash/[id]/restore error', err);
		const message = err instanceof Error ? err.message : 'Internal Server Error';
		const status = message.includes('not found') ? 404 : 500;
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		// DELETE placeholder - no bindings required here
		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('DELETE /api/trash/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};