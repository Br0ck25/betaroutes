// src/routes/api/trips/[id]/+server.ts
import { dev } from '$app/environment';
import { safeDO, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { TripRecord } from '$lib/server/tripService';
import { makeTripService } from '$lib/server/tripService';
import type { RequestHandler } from './$types';

// Helper: Schedule work via platform.context.waitUntil when available
function safeWaitUntil(event: Parameters<RequestHandler>[0], p: Promise<unknown>) {
	try {
		if (event.platform?.context?.waitUntil) {
			event.platform.context.waitUntil(p);
			return;
		}
	} catch {
		// ignore
	}
	void p;
}

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
		const user = event.locals.user as { id?: string } | undefined;
		if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

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
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const userSafe = user as { id?: string; name?: string; token?: string } | undefined;
		const storageId = userSafe?.id || '';

		const trip = await svc.get(storageId, id);

		if (!trip) {
			return new Response('Not Found', { status: 404 });
		}

		// Prefer authoritative mileage from BETA_MILEAGE_KV (merge if present)
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILEAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV,
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
		const user = event.locals.user as { id?: string } | undefined;
		if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const bodyUnknown: unknown = await event.request.json();
		if (typeof bodyUnknown !== 'object' || bodyUnknown === null) {
			return new Response(JSON.stringify({ error: 'Invalid request body' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const body = bodyUnknown as Record<string, unknown>;

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
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const userSafe = user as { id?: string; name?: string; token?: string } | undefined;
		const storageId = userSafe?.id || '';

		// Verify existing ownership
		const existing = await svc.get(storageId, id);
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
				const mileageKV = safeKV(event.platform?.env, 'BETA_MILEAGE_KV');
				if (mileageKV) {
					const mileageSvc = makeMileageService(
						mileageKV,
						safeDO(event.platform?.env, 'TRIP_INDEX_DO')!
					);
					const mileageRec: MileageRecord = {
						id,
						userId: storageId,
						tripId: id,
						date:
							typeof body['date'] === 'string'
								? (body['date'] as string)
								: ((existing as TripRecord).date ?? new Date().toISOString()),
						startOdometer: 0,
						endOdometer: 0,
						miles: Number(body['totalMiles']) || 0,
						createdAt: (existing as TripRecord).createdAt ?? new Date().toISOString(),
						updatedAt: new Date().toISOString()
					};
					const p = mileageSvc
						.put(mileageRec)
						.catch((err) => log.warn('mileage.put failed for trip update', { tripId: id, err }));
					safeWaitUntil(event, p);
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
		const user = event.locals.user as { id?: string } | undefined;
		if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

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
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		const userSafe = user as { id?: string; name?: string; token?: string } | undefined;
		const storageId = userSafe?.id || '';

		// Check if trip exists
		const existing = await svc.get(storageId, id);
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

		// Perform soft delete
		await svc.delete(storageId, id);

		// --- Cascade delete: Delete linked mileage log ---
		try {
			const mileageKV = safeKV(event.platform?.env, 'BETA_MILEAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(
					mileageKV as unknown as KVNamespace,
					tripIndexDO as unknown as DurableObjectNamespace
				);
				// Find mileage logs linked to this trip
				const allMileage = await mileageSvc.list(storageId);
				const linkedMileage = allMileage.filter(
					(m: MileageRecord) => m.tripId === id || m.id === id
				);
				for (const m of linkedMileage) {
					await mileageSvc.delete(storageId, m.id);
					log.info('Cascade deleted mileage log for trip', { tripId: id, mileageId: m.id });
				}
			}
		} catch (e) {
			log.warn('Failed to cascade delete mileage logs', {
				tripId: id,
				message: createSafeErrorMessage(e)
			});
		}

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
