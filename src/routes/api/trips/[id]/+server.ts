// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import type { TripRecord } from '$lib/server/tripService';
import { log } from '$lib/server/log';
import { safeDO, safeKV } from '$lib/server/env';
import { getStorageId, getLegacyStorageId } from '$lib/server/user';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { dev } from '$app/environment';

// [!code fix] SECURITY: Removed dangerous fakeDO fallback that caused silent data loss.
// In production, missing DO bindings now properly error. Dev mode uses a noop stub for testing only.

// SECURITY: Allowed fields for trip updates (prevents mass assignment)
const ALLOWED_UPDATE_FIELDS = new Set([
	'title',
	'stops',
	'date',
	'payDate',
	'startAddress',
	'endAddress',
	'startLocation',
	'endLocation',
	'destinations',
	'startTime',
	'endTime',
	'totalEarnings',
	'fuelCost',
	'maintenanceCost',
	'suppliesCost',
	'maintenanceItems',
	'supplyItems',
	'suppliesItems',
	'totalMiles',
	'hoursWorked',
	'estimatedTime',
	'totalTime'
	// NOTE: netProfit is calculated server-side, not accepted from client
]);

// Pick only allowed fields from body
function pickAllowedFields(body: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const key of ALLOWED_UPDATE_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(body, key)) {
			result[key] = body[key];
		}
	}
	return result;
}

// Calculate net profit server-side (SECURITY: never trust client calculations)
function calculateNetProfit(trip: Record<string, unknown>): number {
	const earnings = Number(trip['totalEarnings']) || 0;
	const fuel = Number(trip['fuelCost']) || 0;
	const maintenance = Number(trip['maintenanceCost']) || 0;
	const supplies = Number(trip['suppliesCost']) || 0;
	return earnings - fuel - maintenance - supplies;
}

/**
 * GET /api/trips/[id] - Retrieve a single trip
 */
export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

		// Connect to KVs
		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] SECURITY: Fail properly in production if DO bindings are missing
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO');
		if (!tripIndexDO && !dev) {
			log.error('[API/trips/[id]] TRIP_INDEX_DO binding missing in production');
			return new Response('Service Unavailable', { status: 503 });
		}
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service (add placesIndexDO)
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
		const storageId = getStorageId(user);
		// MIGRATION COMPATIBILITY: Also get legacy username for fallback lookups
		const legacyStorageId = getLegacyStorageId(user);

		// Try UUID key first, then legacy username key
		const trip = await svc.get(storageId, id, legacyStorageId);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		// Prefer authoritative mileage from BETA_MILLAGE_KV (merge if present)
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV as any,
					safeDO(event.platform?.env, 'TRIP_INDEX_DO')!
				);
				const m = await mileageSvc.get(storageId, id);
				if (m && typeof m.miles === 'number') trip.totalMiles = m.miles;
			}
		} catch (err) {
			log.warn('Failed to merge mileage into trip response', { tripId: id, err });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('GET /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

/**
 * PUT /api/trips/[id] - Update a trip
 */
export const PUT: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const body = (await event.request.json()) as Record<string, unknown>;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] SECURITY: Fail properly in production if DO bindings are missing
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO');
		if (!tripIndexDO && !dev) {
			log.error('[API/trips/[id]] TRIP_INDEX_DO binding missing in production');
			return new Response('Service Unavailable', { status: 503 });
		}
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service (add placesIndexDO)
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
		const storageId = getStorageId(user);
		// MIGRATION COMPATIBILITY: Also get legacy username for fallback lookups
		const legacyStorageId = getLegacyStorageId(user);

		// Verify existing ownership (try UUID key first, then legacy username key)
		const existing = await svc.get(storageId, id, legacyStorageId);
		if (!existing) {
			return new Response('Not Found', { status: 404 });
		}

		// SECURITY: Only pick allowed fields from body (prevents mass assignment)
		const allowedUpdates = pickAllowedFields(body);

		const updated = {
			...(existing as Record<string, unknown>),
			...allowedUpdates,
			id, // immutable
			userId: storageId, // immutable
			createdAt: existing.createdAt, // immutable
			updatedAt: new Date().toISOString(),
			// SECURITY: Calculate netProfit server-side (never trust client)
			netProfit: calculateNetProfit({
				...(existing as Record<string, unknown>),
				...allowedUpdates
			})
		};

		await svc.put(updated as unknown as TripRecord);

		// If client edited totalMiles, persist authoritative mileage to its own KV so updates propagate to other clients
		try {
			if (Object.prototype.hasOwnProperty.call(body, 'totalMiles')) {
				const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
				if (mileageKV) {
					const mileageSvc = makeMileageService(
						mileageKV as any,
						safeDO(event.platform?.env, 'TRIP_INDEX_DO')!
					);
					const mileageRec = {
						id,
						userId: storageId,
						date: (body['date'] as string) || (existing as any).date || new Date().toISOString(),
						startOdometer: 0,
						endOdometer: 0,
						miles: Number((body as any).totalMiles) || 0,
						createdAt: (existing as any).createdAt || new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const p = mileageSvc
						.put(mileageRec as any)
						.catch((err) => log.warn('mileage.put failed for trip update', { tripId: id, err }));
					try {
						if (event.platform?.context?.waitUntil) event.platform.context.waitUntil(p as any);
						else if ((event as any)?.context?.waitUntil) (event as any).context.waitUntil(p);
					} catch {
						void p;
					}
				}
			}
		} catch (err) {
			log.warn('Failed to persist mileage for trip update', {
				tripId: id,
				message: createSafeErrorMessage(err)
			});
		}

		return new Response(JSON.stringify(updated), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

/**
 * DELETE /api/trips/[id] - Soft delete trip (move to trash)
 */
export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;

		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
		// [!code fix] SECURITY: Fail properly in production if DO bindings are missing
		const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO');
		if (!tripIndexDO && !dev) {
			log.error('[API/trips/[id]] TRIP_INDEX_DO binding missing in production');
			return new Response('Service Unavailable', { status: 503 });
		}
		const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') ?? tripIndexDO;

		// [!code fix] Pass DO to service
		const svc = makeTripService(
			kv as unknown as KVNamespace,
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		// SECURITY FIX (P0 Item #1): Use getStorageId() to get user UUID, never name/token
		const storageId = getStorageId(user);
		// MIGRATION COMPATIBILITY: Also get legacy username for fallback lookups
		const legacyStorageId = getLegacyStorageId(user);

		// Check if trip exists (try UUID key first, then legacy username key)
		const existing = await svc.get(storageId, id, legacyStorageId);
		if (!existing) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// If trip is already deleted (tombstone), return success (idempotent)
		if (existing.deleted) {
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Perform soft delete (pass legacyStorageId for fallback key lookup)
		await svc.delete(storageId, id, legacyStorageId);

		// --- Cascade delete: Delete linked mileage log ---
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILLAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV as unknown as KVNamespace,
					tripIndexDO as unknown as DurableObjectNamespace
				);
				// Find mileage logs linked to this trip (try both UUID and legacy username)
				const allMileage = await mileageSvc.list(storageId);
				// Also check legacy key if we have one
				if (legacyStorageId && legacyStorageId !== storageId) {
					const legacyMileage = await mileageSvc.list(legacyStorageId);
					// Merge without duplicates
					const ids = new Set(allMileage.map((m: MileageRecord) => m.id));
					for (const m of legacyMileage) {
						if (!ids.has(m.id)) {
							allMileage.push(m);
						}
					}
				}
				const linkedMileage = allMileage.filter(
					(m: MileageRecord) => m.tripId === id || m.id === id
				);
				for (const m of linkedMileage) {
					// Pass legacyStorageId for fallback key lookup
					await mileageSvc.delete(storageId, m.id, legacyStorageId);
					log.info('Cascade deleted mileage log for trip', { tripId: id, mileageId: m.id });
				}
			}
		} catch (e) {
			log.warn('Failed to cascade delete mileage logs', {
				tripId: id,
				message: createSafeErrorMessage(e)
			});
		}

		// SECURITY FIX (P0 Item #1): Use storageId (user UUID) instead of token
		await svc.incrementUserCounter(storageId, -1);

		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('DELETE /api/trips/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
