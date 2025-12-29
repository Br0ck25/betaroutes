// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { log } from '$lib/server/log';

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

		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
		const kv = (platformEnv?.['BETA_LOGS_KV'] as unknown) ?? fakeKV();
		const trashKV = (platformEnv?.['BETA_LOGS_TRASH_KV'] as unknown) ?? fakeKV();
		const placesKV = (platformEnv?.['BETA_PLACES_KV'] as unknown) ?? fakeKV();

		// Durable Object bindings (mock or real)
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		// Create service - cast to expected runtime types with unknown intermediary
		const svc = makeTripService(
			kv as any,
			trashKV as any,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const currentUser = user as { name?: string; token?: string };
		const storageId = currentUser.name || currentUser.token;

		// If no storage id available (shouldn't happen), return empty list early
		if (!storageId)
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});

		// Return current cloud trash items (may be empty)
		let cloudTrash: unknown[] = [];
		try {
			cloudTrash = await svc.list(storageId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('Failed to list cloud trash', { message });
		}

		return new Response(JSON.stringify(cloudTrash), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('GET /api/trash error', { message });
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
		const message = err instanceof Error ? err.message : String(err);
		log.error('DELETE /api/trash error', { message });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500
		});
	}
};
