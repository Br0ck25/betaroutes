// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMillageService } from '$lib/server/millageService';
import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
}

// Fake DO helper
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
		const placesKV = (platformEnv?.['BETA_PLACES_KV'] as unknown) ?? fakeKV();

		// Durable Object bindings (mock or real)
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		// Create service
		const svc = makeTripService(
			kv as any,
			undefined,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		// Prefer username first to match expense behavior
		const storageId = currentUser.name || currentUser.token || currentUser.id;

		if (!storageId)
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});

		// Return current cloud trash items (merge or filter by type)
		let cloudTrash: unknown[] = [];
		try {
			const type = (event.url.searchParams.get('type') || '').toLowerCase();
			const tripTrash = await svc.listTrash(storageId);
			if (type === 'expenses') {
				const expenseSvc = makeExpenseService(
					safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				cloudTrash = await expenseSvc.listTrash(storageId);
			} else if (type === 'millage') {
				const millageSvc = makeMillageService(
					safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				cloudTrash = await millageSvc.listTrash(storageId);
			} else if (type === 'trips') {
				cloudTrash = tripTrash;
			} else {
				const expenseSvc = makeExpenseService(
					safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				const expenseTrash = await expenseSvc.listTrash(storageId);
				const millageSvc = makeMillageService(
					safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
					safeDO(platformEnv, 'TRIP_INDEX_DO') as any
				);
				const millageTrash = await millageSvc.listTrash(storageId);
				cloudTrash = [...tripTrash, ...expenseTrash, ...millageTrash].sort((a: any, b: any) =>
					(b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || '')
				);
			}
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

		// This bulk DELETE endpoint is currently a placeholder
		// Individual items are deleted via /api/trash/[id]
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
