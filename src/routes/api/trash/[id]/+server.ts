// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeExpenseService } from '$lib/server/expenseService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { dev } from '$app/environment';

// [!code fix] SECURITY: Removed dangerous fakeDO fallback that caused silent data loss in production.

// Helpers (top-level per governance rules)
type Tombstone = {
	deleted?: boolean;
	backup?: unknown;
	data?: unknown;
	deletedAt?: string;
	[id: string]: unknown;
};

function parseTombstone(raw?: string | null): Tombstone | null {
	if (!raw) return null;
	try {
		const t = JSON.parse(raw);
		if (t && typeof t === 'object') return t as Tombstone;
	} catch {
		// invalid tombstone JSON - treat as missing
	}
	return null;
}

function isTrip(obj: unknown): obj is { stops?: unknown[]; startAddress?: string } {
	if (!obj || typeof obj !== 'object') return false;
	const o = obj as Record<string, unknown>;
	if (Array.isArray(o['stops'])) return true;
	if (
		typeof o['startAddress'] === 'string' &&
		o['startAddress'] &&
		String(o['startAddress']).length > 0
	)
		return true;
	return false;
}

// Extract userId from restored object for ownership checks
function getRestoredUserId(obj: unknown): string | undefined {
	if (!obj || typeof obj !== 'object') return undefined;
	const o = obj as Record<string, unknown>;
	return typeof o['userId'] === 'string' ? String(o['userId']) : undefined;
}

// Map common restore errors to HTTP status codes and messages
function mapRestoreError(err: unknown): { status: number; message: string } {
	const msg = err instanceof Error ? err.message : String(err);
	const lower = msg.toLowerCase();
	if (lower.includes('not found')) return { status: 404, message: 'Item not found in trash' };
	if (lower.includes('not deleted') || lower.includes('backup data not found'))
		return { status: 409, message: msg };
	if (lower.includes('cannot restore mileage') || lower.includes('parent trip'))
		return { status: 409, message: msg };
	if (lower.includes('restore failed')) return { status: 500, message: 'Restore failed' };
	return { status: 500, message: 'Internal Server Error' };
}

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
			safeKV(platformEnv, 'BETA_LOGS_KV') as KVNamespace,
			undefined,
			safeKV(platformEnv, 'BETA_PLACES_KV') as KVNamespace | undefined,
			tripIndexDO as DurableObjectNamespace,
			placesIndexDO as DurableObjectNamespace
		);

		const expenseSvc = makeExpenseService(
			safeKV(platformEnv, 'BETA_EXPENSES_KV') as KVNamespace,
			tripIndexDO as DurableObjectNamespace
		);

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILEAGE_KV') as KVNamespace,
			tripIndexDO as DurableObjectNamespace,
			safeKV(platformEnv, 'BETA_LOGS_KV') as KVNamespace | undefined
		);

		const currentUser = user as { id?: string; name?: string; token?: string };
		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = currentUser?.id || '';

		if (storageId) {
			// Read tombstones first so we only attempt restore on the service that actually
			// has a deleted tombstone for this ID. This prevents tripService from aborting
			// when a mileage tombstone exists with the same ID (auto-created mileage by trip).
			const tripKV = safeKV(platformEnv, 'BETA_LOGS_KV');
			const expenseKV = safeKV(platformEnv, 'BETA_EXPENSES_KV');
			const mileageKV = safeKV(platformEnv, 'BETA_MILEAGE_KV');

			const tripRaw = tripKV ? await (tripKV as KVNamespace).get(`trip:${storageId}:${id}`) : null;
			const expenseRaw = expenseKV
				? await (expenseKV as KVNamespace).get(`expense:${storageId}:${id}`)
				: null;
			const mileageRaw = mileageKV
				? await (mileageKV as KVNamespace).get(`mileage:${storageId}:${id}`)
				: null;

			const tripT = parseTombstone(tripRaw as string | null);
			const expenseT = parseTombstone(expenseRaw as string | null);
			const mileageT = parseTombstone(mileageRaw as string | null);

			let restored: unknown | null = null;
			let lastError: string | null = null;

			// If a tombstone exists, prefer restoring that type
			if (tripT?.deleted) {
				try {
					restored = await tripSvc.restore(storageId, id);
				} catch (err) {
					const mapped = mapRestoreError(err);
					return new Response(JSON.stringify({ error: mapped.message }), { status: mapped.status });
				}
			} else if (mileageT?.deleted) {
				// Validate parent trip + conflicts before attempting mileage restore
				try {
					const mileageData = (mileageT?.backup ?? mileageT?.data ?? null) as Record<
						string,
						unknown
					> | null;
					if (mileageData && typeof mileageData['tripId'] === 'string') {
						const tripId = String(mileageData['tripId']);
						const trip = await tripSvc.get(storageId, tripId);
						if (!trip || trip.deleted) {
							return new Response(
								JSON.stringify({ error: 'Cannot restore mileage: parent trip is deleted' }),
								{ status: 409 }
							);
						}

						const activeMileage = await mileageSvc.list(storageId);
						const conflictingMileage = activeMileage.find(
							(m: MileageRecord) => m.tripId === tripId && m.id !== id
						);
						if (conflictingMileage) {
							return new Response(
								JSON.stringify({
									error: 'Cannot restore mileage: another active mileage log exists for this trip'
								}),
								{ status: 409 }
							);
						}
					}

					restored = await mileageSvc.restore(storageId, id);
					// Sync restored miles back to trip if present
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
					const errMsg = err instanceof Error ? err.message : String(err);
					// Validation errors for mileage should be surfaced as 409
					if (errMsg.includes('Cannot restore mileage')) {
						return new Response(JSON.stringify({ error: errMsg }), { status: 409 });
					}
					lastError = errMsg;
				}
			} else if (expenseT?.deleted) {
				try {
					restored = await expenseSvc.restore(storageId, id);
				} catch (err) {
					const mapped = mapRestoreError(err);
					return new Response(JSON.stringify({ error: mapped.message }), { status: mapped.status });
				}
			} else {
				// No tombstone found - fall back to trial on all services (preserves existing behavior)
				try {
					restored = await tripSvc.restore(storageId, id);
				} catch (err) {
					const mapped = mapRestoreError(err);
					if (mapped.status !== 404) {
						return new Response(JSON.stringify({ error: mapped.message }), {
							status: mapped.status
						});
					}
					lastError = mapped.message;
					try {
						restored = await expenseSvc.restore(storageId, id);
					} catch (err2) {
						const mapped2 = mapRestoreError(err2);
						if (mapped2.status !== 404) {
							return new Response(JSON.stringify({ error: mapped2.message }), {
								status: mapped2.status
							});
						}
						lastError = mapped2.message;
						try {
							restored = await mileageSvc.restore(storageId, id);
						} catch (err3) {
							const mapped3 = mapRestoreError(err3);
							if (mapped3.status !== 404) {
								return new Response(JSON.stringify({ error: mapped3.message }), {
									status: mapped3.status
								});
							}
							lastError = mapped3.message;
						}
					}
				}
			}

			// If a restore succeeded, enforce ownership and return success
			if (restored) {
				const restoredUser = getRestoredUserId(restored);
				if (restoredUser && restoredUser !== storageId) {
					return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
				}

				// Only trips need counter incrementing
				type TripCounter = {
					incrementUserCounter?: (userId: string, n: number) => Promise<number>;
				};
				const tripCounter = tripSvc as TripCounter;
				try {
					if (isTrip(restored) && typeof tripCounter.incrementUserCounter === 'function') {
						await tripCounter.incrementUserCounter(storageId, 1);
					}
				} catch {
					// intentionally swallow counter errors
				}

				return new Response(JSON.stringify({ success: true }), { status: 200 });
			}

			// If all restore attempts returned 404 / not found, surface a consistent 404
			if (lastError) {
				return new Response(JSON.stringify({ error: lastError }), { status: 404 });
			}

			return new Response(JSON.stringify({ error: 'Item not found in trash' }), { status: 404 });
		}

		// If we fall through because storageId is falsy or outer logic didn't return, surface 404
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
			safeKV(platformEnv, 'BETA_LOGS_KV') as KVNamespace,
			undefined,
			safeKV(platformEnv, 'BETA_PLACES_KV') as KVNamespace | undefined,
			tripIndexDO as DurableObjectNamespace,
			placesIndexDO as DurableObjectNamespace
		);

		const expenseSvc = makeExpenseService(
			safeKV(platformEnv, 'BETA_EXPENSES_KV') as KVNamespace,
			tripIndexDO as DurableObjectNamespace
		);

		const mileageSvc = makeMileageService(
			safeKV(platformEnv, 'BETA_MILEAGE_KV') as KVNamespace,
			tripIndexDO as DurableObjectNamespace
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
					const tripRaw = await (tripKV as KVNamespace).get(`trip:${storageId}:${id}`);
					const parsedTrip = parseTombstone(tripRaw as string | null);
					if (parsedTrip?.deleted) foundType = 'trip';
				}

				if (!foundType && mileageKV) {
					const mileageRaw = await (mileageKV as KVNamespace).get(`mileage:${storageId}:${id}`);
					const parsedMileage = parseTombstone(mileageRaw as string | null);
					if (parsedMileage?.deleted) foundType = 'mileage';
				}

				if (!foundType && expenseKV) {
					const expenseRaw = await (expenseKV as KVNamespace).get(`expense:${storageId}:${id}`);
					const parsedExpense = parseTombstone(expenseRaw as string | null);
					if (parsedExpense?.deleted) foundType = 'expense';
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
