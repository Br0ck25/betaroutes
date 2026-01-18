// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMillageService, type MillageRecord } from '$lib/server/millageService';
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

		const millageSvc = makeMillageService(
			safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
			tripIndexDO as any
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
						// Get the mileage item from trash to check its tripId
						const millageKV = safeKV(platformEnv, 'BETA_MILLAGE_KV');
						if (millageKV) {
							const raw = await (millageKV as any).get(`millage:${storageId}:${id}`);
							if (raw) {
								const tombstone = JSON.parse(raw);
								const millageData = tombstone.backup || tombstone.data || tombstone;
								
								// Check if mileage has a linked trip
								if (millageData.tripId) {
									// Check if parent trip is deleted
									const trip = await tripSvc.get(storageId, millageData.tripId);
									if (!trip || trip.deleted) {
										throw new Error('Cannot restore mileage: parent trip is deleted');
									}
									
									// Check if another active mileage log exists for this trip
									const activeMillage = await millageSvc.list(storageId);
									const conflictingMillage = activeMillage.find(
										(m: MillageRecord) => m.tripId === millageData.tripId && m.id !== id
									);
									if (conflictingMillage) {
										throw new Error('Cannot restore mileage: another active mileage log exists for this trip');
									}
								}
							}
						}
						
						restored = await millageSvc.restore(storageId, id);
						
						// If restored mileage has a tripId, sync the miles back to the trip
						const restoredMillage = restored as MillageRecord | undefined;
						if (restoredMillage && restoredMillage.tripId && typeof restoredMillage.miles === 'number') {
							try {
								const trip = await tripSvc.get(storageId, restoredMillage.tripId);
								if (trip && !trip.deleted) {
									trip.totalMiles = restoredMillage.miles;
									trip.updatedAt = new Date().toISOString();
									await tripSvc.put(trip);
									log.info('Synced restored mileage to trip', { tripId: restoredMillage.tripId, miles: restoredMillage.miles });
								}
							} catch (e) {
								log.warn('Failed to sync restored mileage to trip', { message: String(e) });
							}
						}
					} catch (millageError) {
						// Check if this is a validation error that we should surface
						const errMsg = millageError instanceof Error ? millageError.message : String(millageError);
						if (errMsg.includes('Cannot restore mileage')) {
							return new Response(JSON.stringify({ error: errMsg }), { status: 409 });
						}
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
