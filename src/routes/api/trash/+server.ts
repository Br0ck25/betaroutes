// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMillageService } from '$lib/server/millageService';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { getStorageId } from '$lib/server/user';

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

		// Durable Object bindings
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		// Initialize Services
		const tripSvc = makeTripService(
			kv as any,
			undefined,
			placesKV as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const expenseSvc = makeExpenseService(
			safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
			tripIndexDO as any
		);

		const millageSvc = makeMillageService(
			safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
			tripIndexDO as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		const storageId = getStorageId(currentUser);

		if (!storageId) {
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		let cloudTrash: unknown[] = [];
		try {
			const type = (event.url.searchParams.get('type') || '').toLowerCase();

			// Fetch based on filter or fetch all
			if (type === 'expenses') {
				cloudTrash = await expenseSvc.listTrash(storageId);
			} else if (type === 'millage') {
				cloudTrash = await millageSvc.listTrash(storageId);
			} else if (type === 'trips') {
				cloudTrash = await tripSvc.listTrash(storageId);
			} else {
				// Fetch ALL and merge
				const [trips, expenses, millage] = await Promise.all([
					tripSvc.listTrash(storageId),
					expenseSvc.listTrash(storageId),
					millageSvc.listTrash(storageId)
				]);

				cloudTrash = [...trips, ...expenses, ...millage].sort((a: any, b: any) =>
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

export const DELETE: RequestHandler = async () => {
	// Bulk delete implementation usually done one-by-one by client,
	// or implemented here if needed. Keeping placeholder for now.
	return new Response(JSON.stringify({ deleted: 0 }), { status: 200 });
};
