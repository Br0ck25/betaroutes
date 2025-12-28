// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
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

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV();
		// [!code fix]
		const tripIndexDO = (event.platform?.env as any)?.TRIP_INDEX_DO ?? fakeDO();
		const placesIndexDO = (event.platform?.env as any)?.PLACES_INDEX_DO ?? tripIndexDO;
		
		// [!code fix]
		const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any, placesIndexDO as any);

		const storageId = (user as any).name || (user as any).token;

		// Return current cloud trash items (may be empty)
		let cloudTrash: any[] = [];
		try {
			cloudTrash = await svc.list(storageId);
		} catch (e) { console.warn('Failed to list cloud trash', e); }

		return new Response(JSON.stringify(cloudTrash), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('GET /api/trash error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		// DELETE placeholder - no bindings required here
		
		// Perform permanent deletion (not implemented here; return placeholder)
		const deleted = 0;

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
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500
		});
	}
};