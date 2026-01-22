// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
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

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
			tripIndexDO as any,
			safeKV(platformEnv, 'BETA_LOGS_KV') as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		const storageId = getStorageId(currentUser);

		if (!storageId) {
			return new Response(JSON.stringify({ error: 'Invalid user' }), { status: 400 });
		}

		let restored: unknown | null = null;
		let restoredType: 'trip' | 'expense' | 'mileage' | null = null;
		let lastError: string | null = null;

		// Step 1: Try to restore as a trip first
		try {
			restored = await tripSvc.restore(storageId, id);
			restoredType = 'trip';
			log.info('Restored trip from trash', { tripId: id });
		} catch {
			// Not a trip, try expense
			try {
				// Check if this expense has a tripId and that trip is deleted
				const expenseKV = safeKV(platformEnv, 'BETA_EXPENSES_KV');
				if (expenseKV) {
					const raw = await (expenseKV as any).get(`expense:${storageId}:${id}`);
					if (raw) {
						const tombstone = JSON.parse(raw);
						const expenseData = tombstone.backup || tombstone.data || tombstone;

						// If this expense was cascade deleted, user shouldn't see it in trash
						// but allow restore via API if trip is restored first
						if (expenseData.tripId && !tombstone.cascadeDeleted) {
							const trip = await tripSvc.get(storageId, expenseData.tripId);
							if (!trip || trip.deleted) {
								throw new Error('Cannot restore expense: parent trip is deleted');
							}
						}
					}
				}
				restored = await expenseSvc.restore(storageId, id);
				restoredType = 'expense';
				log.info('Restored expense from trash', { expenseId: id });
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				if (errMsg.includes('Cannot restore expense')) {
					return new Response(JSON.stringify({ error: errMsg }), { status: 409 });
				}

				// Not an expense, try mileage
				try {
					// Get the mileage item from trash to check its tripId
					const mileageKV = safeKV(platformEnv, 'BETA_MILLAGE_KV');
					if (mileageKV) {
						const raw = await (mileageKV as any).get(`mileage:${storageId}:${id}`);
						if (raw) {
							const tombstone = JSON.parse(raw);
							const mileageData = tombstone.backup || tombstone.data || tombstone;

							// Check if mileage has a linked trip (and wasn't cascade deleted)
							if (mileageData.tripId && !tombstone.cascadeDeleted) {
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
					restoredType = 'mileage';
					log.info('Restored mileage from trash', { mileageId: id });

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
				} catch (mileageErr) {
					// Check if this is a validation error that we should surface
					const mileageErrMsg =
						mileageErr instanceof Error ? mileageErr.message : String(mileageErr);
					if (mileageErrMsg.includes('Cannot restore mileage')) {
						return new Response(JSON.stringify({ error: mileageErrMsg }), { status: 409 });
					}
					// Store the error for later use if no restore succeeded
					lastError = mileageErrMsg;
				}
			}
		}

		// Step 2: If we restored a trip, cascade restore linked mileage and expenses
		if (restoredType === 'trip') {
			// Cascade restore mileage logs that were cascade-deleted with this trip
			try {
				const mileageKV = safeKV(platformEnv, 'BETA_MILLAGE_KV');
				if (mileageKV) {
					const prefix = `mileage:${storageId}:`;
					let list = await (mileageKV as any).list({ prefix });
					let keys = list.keys;
					while (!list.list_complete && list.cursor) {
						list = await (mileageKV as any).list({ prefix, cursor: list.cursor });
						keys = keys.concat(list.keys);
					}

					for (const k of keys) {
						const raw = await (mileageKV as any).get(k.name);
						if (!raw) continue;
						const parsed = JSON.parse(raw);
						// Only restore if it was cascade deleted AND linked to this trip
						if (
							parsed.deleted &&
							parsed.cascadeDeleted &&
							(parsed.tripId === id || (parsed.backup && parsed.backup.tripId === id))
						) {
							try {
								await mileageSvc.restore(storageId, parsed.id);
								log.info('Cascade restored mileage with trip', {
									tripId: id,
									mileageId: parsed.id
								});
							} catch (e) {
								log.warn('Failed to cascade restore mileage', {
									mileageId: parsed.id,
									error: String(e)
								});
							}
						}
					}
				}
			} catch (e) {
				log.warn('Failed to cascade restore mileage logs', { tripId: id, error: String(e) });
			}

			// Cascade restore expense logs that were cascade-deleted with this trip
			try {
				const expenseKV = safeKV(platformEnv, 'BETA_EXPENSES_KV');
				if (expenseKV) {
					const prefix = `expense:${storageId}:`;
					let list = await (expenseKV as any).list({ prefix });
					let keys = list.keys;
					while (!list.list_complete && list.cursor) {
						list = await (expenseKV as any).list({ prefix, cursor: list.cursor });
						keys = keys.concat(list.keys);
					}

					for (const k of keys) {
						const raw = await (expenseKV as any).get(k.name);
						if (!raw) continue;
						const parsed = JSON.parse(raw);
						// Only restore if it was cascade deleted AND linked to this trip
						if (
							parsed.deleted &&
							parsed.cascadeDeleted &&
							(parsed.tripId === id || (parsed.backup && parsed.backup.tripId === id))
						) {
							try {
								await expenseSvc.restore(storageId, parsed.id);
								log.info('Cascade restored expense with trip', {
									tripId: id,
									expenseId: parsed.id
								});
							} catch (e) {
								log.warn('Failed to cascade restore expense', {
									expenseId: parsed.id,
									error: String(e)
								});
							}
						}
					}
				}
			} catch (e) {
				log.warn('Failed to cascade restore expense logs', { tripId: id, error: String(e) });
			}
		}

		if (restored) {
			// Only trips need counter incrementing
			if (restoredType === 'trip') {
				try {
					await (tripSvc as any).incrementUserCounter?.(currentUser.token || '', 1);
				} catch {
					void 0;
				}
			}

			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}

		// If all restore attempts failed with a validation error, surface it
		if (lastError) {
			return new Response(JSON.stringify({ error: lastError }), { status: 409 });
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

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILLAGE_KV') as any,
			tripIndexDO as any
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		const storageId = getStorageId(currentUser);

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
				const mileageKV = safeKV(platformEnv, 'BETA_MILLAGE_KV');

				// Check each service for a tombstone record
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
