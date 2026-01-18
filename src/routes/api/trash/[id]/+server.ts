// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMillageService } from '$lib/server/millageService';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { getStorageId } from '$lib/server/user';

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
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		const tripSvc = makeTripService(
			safeKV(platformEnv, 'BETA_LOGS_KV') as any,
			undefined,
			safeKV(platformEnv, 'BETA_PLACES_KV') as any,
			tripIndexDO as any,
			placesIndexDO as any
		);

		const expenseSvc = makeExpenseService(
			safeKV(platformEnv, 'BETA_EXPENSES_KV') as any,
			tripIndexDO as any
		);

		// [!code fix] Capture Trip KV for restore guard logic
		const logsKV = safeKV(platformEnv, 'BETA_LOGS_KV');

		const millageSvc = makeMillageService(
			safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
			tripIndexDO as any,
			logsKV as any // [!code ++] Pass Trip KV to service
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		const storageId = getStorageId(currentUser);

		if (storageId) {
			let restored: unknown | null = null;

			// Strategy: Try sequentially until one succeeds
			try {
				restored = await tripSvc.restore(storageId, id);
			} catch {
				try {
					restored = await expenseSvc.restore(storageId, id);
				} catch {
					try {
						// This will now throw if parent trip is deleted
						restored = await millageSvc.restore(storageId, id);
					} catch {
						// all attempts failed; no-op
						void 0;
					}
				}
			}

			if (restored) {
				// Only trips need counter incrementing
				try {
					if ((restored as any).stops || (restored as any).startAddress) {
						await (tripSvc as any).incrementUserCounter?.(currentUser.token || '', 1);
					}
				} catch {
					void 0;
				}

				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}
		}

		return new Response(JSON.stringify({ error: 'Item not found in trash' }), { status: 404 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('POST /api/trash/[id]/restore error', { message });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
		const tripIndexDO = (platformEnv?.['TRIP_INDEX_DO'] as unknown) ?? fakeDO();
		const placesIndexDO = (platformEnv?.['PLACES_INDEX_DO'] as unknown) ?? tripIndexDO;

		// Initialize all services
		const tripSvc = makeTripService(
			safeKV(platformEnv, 'BETA_LOGS_KV') as any,
			undefined,
			safeKV(platformEnv, 'BETA_PLACES_KV') as any,
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

		if (storageId) {
			// Try to delete from ALL possible locations to ensure cleanup
			// We use Promise.allSettled to ensure one failure doesn't stop others
			await Promise.allSettled([
				tripSvc.permanentDelete(storageId, id),
				expenseSvc.permanentDelete(storageId, id),
				millageSvc.permanentDelete(storageId, id)
			]);
		}

		return new Response(null, { status: 204 });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('DELETE /api/trash/[id] error', { message });
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
