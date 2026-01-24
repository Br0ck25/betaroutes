// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { dev } from '$app/environment';

// [!code fix] SECURITY: Removed dangerous fakeDO fallback that caused silent data loss in production.

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;

		// [!code fix] SECURITY: Fail properly in production if DO bindings are missing
		const tripIndexDO = safeDO(platformEnv, 'TRIP_INDEX_DO');
		if (!tripIndexDO && !dev) {
			log.error('[API/trash/[id]] TRIP_INDEX_DO binding missing in production');
			return new Response('Service Unavailable', { status: 503 });
		}
		const placesIndexDO = safeDO(platformEnv, 'PLACES_INDEX_DO') ?? tripIndexDO;

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

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILEAGE_KV') as any,
			tripIndexDO as any,
			safeKV(platformEnv, 'BETA_LOGS_KV') as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = currentUser?.id || '';

		if (storageId) {
			let restored: unknown | null = null;
			let lastError: string | null = null;

			// Strategy: Try sequentially until one succeeds
			try {
				restored = await tripSvc.restore(storageId, id);
			} catch {
				try {
					restored = await expenseSvc.restore(storageId, id);
				} catch {
					try {
						// Get the mileage item from trash to check its tripId
						const mileageKV = safeKV(platformEnv, 'BETA_MILEAGE_KV');
						if (mileageKV) {
							const raw = await (mileageKV as any).get(`mileage:${storageId}:${id}`);
							if (raw) {
								const tombstone = JSON.parse(raw);
								const mileageData = tombstone.backup || tombstone.data || tombstone;

								// Check if mileage has a linked trip
								if (mileageData.tripId) {
									// Check if parent trip is deleted
									const trip = await tripSvc.get(storageId, mileageData.tripId);
									if (!trip || trip.deleted) {
										throw new Error('Cannot restore mileage: parent trip is deleted');
									}

									// Check if another active mileage log exists for this trip
									const activeMileage = await mileageSvc.list(storageId);
									const conflictingMileage = activeMileage.find(
										(m: MileageRecord) => m.tripId === mileageData.tripId && m.id !== id
									);
									if (conflictingMileage) {
										throw new Error(
											'Cannot restore mileage: another active mileage log exists for this trip'
										);
									}
								}
							}
						}

						restored = await mileageSvc.restore(storageId, id);
						// If restored mileage has a tripId, sync the miles back to the trip
						const restoredMileage = restored as MileageRecord | undefined;
						if (
							restoredMileage &&
							restoredMileage.tripId &&
							typeof restoredMileage.miles === 'number'
						) {
							try {
								const trip = await tripSvc.get(storageId, restoredMileage.tripId);
								if (trip && !trip.deleted) {
									trip.totalMiles = restoredMileage.miles;
									trip.updatedAt = new Date().toISOString();
									await tripSvc.put(trip);
									log.info('Synced restored mileage to trip', {
										tripId: restoredMileage.tripId,
										miles: restoredMileage.miles
									});
								}
							} catch (e) {
								log.warn('Failed to sync restored mileage to trip', { message: String(e) });
							}
						}
					} catch (err) {
						// Check if this is a validation error that we should surface
						const errMsg = err instanceof Error ? err.message : String(err);
						if (errMsg.includes('Cannot restore mileage')) {
							return new Response(JSON.stringify({ error: errMsg }), { status: 409 });
						}
						// Store the error for later use if no restore succeeded
						lastError = errMsg;
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

			// If all restore attempts failed with a validation error, surface it
			if (lastError) {
				return new Response(JSON.stringify({ error: lastError }), { status: 409 });
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
		// Accept optional 'type' query param to specify which record type to delete
		const recordType = event.url.searchParams.get('type');
		const platformEnv = event.platform?.env as Record<string, unknown> | undefined;

		// [!code fix] SECURITY: Fail properly in production if DO bindings are missing
		const tripIndexDO = safeDO(platformEnv, 'TRIP_INDEX_DO');
		if (!tripIndexDO && !dev) {
			log.error('[API/trash/[id]] TRIP_INDEX_DO binding missing in production');
			return new Response('Service Unavailable', { status: 503 });
		}
		const placesIndexDO = safeDO(platformEnv, 'PLACES_INDEX_DO') ?? tripIndexDO;

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

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILEAGE_KV') as any,
			tripIndexDO as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = currentUser?.id || '';

		if (storageId) {
			// If record type is specified, only delete from that specific service
			// This prevents accidentally deleting a trip when user only wants to delete mileage
			if (recordType === 'mileage') {
				await mileageSvc.permanentDelete(storageId, id);
			} else if (recordType === 'expense') {
				await expenseSvc.permanentDelete(storageId, id);
			} else if (recordType === 'trip') {
				await tripSvc.permanentDelete(storageId, id);
			} else {
				// No type specified - detect which service has this record in trash
				// by checking which KV has a tombstone for this ID
				const tripKV = safeKV(platformEnv, 'BETA_LOGS_KV');
				const expenseKV = safeKV(platformEnv, 'BETA_EXPENSES_KV');
				const mileageKV = safeKV(platformEnv, 'BETA_MILEAGE_KV');
				let foundType: string | null = null;

				if (tripKV) {
					const tripRaw = await (tripKV as any).get(`trip:${storageId}:${id}`);
					if (tripRaw) {
						const parsed = JSON.parse(tripRaw);
						if (parsed.deleted) foundType = 'trip';
					}
				}

				if (!foundType && mileageKV) {
					const mileageRaw = await (mileageKV as any).get(`mileage:${storageId}:${id}`);
					if (mileageRaw) {
						const parsed = JSON.parse(mileageRaw);
						if (parsed.deleted) foundType = 'mileage';
					}
				}

				if (!foundType && expenseKV) {
					const expenseRaw = await (expenseKV as any).get(`expense:${storageId}:${id}`);
					if (expenseRaw) {
						const parsed = JSON.parse(expenseRaw);
						if (parsed.deleted) foundType = 'expense';
					}
				}

				// Only delete from the service that has the tombstone
				if (foundType === 'trip') {
					await tripSvc.permanentDelete(storageId, id);
				} else if (foundType === 'mileage') {
					await mileageSvc.permanentDelete(storageId, id);
				} else if (foundType === 'expense') {
					await expenseSvc.permanentDelete(storageId, id);
				} else {
					// If no tombstone found, log warning but still try cleanup as fallback
					// This handles edge cases where the tombstone was already deleted
					log.warn('No tombstone found for permanent delete, skipping', { id, storageId });
				}
			}
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
