// src/routes/api/mileage/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeMileageService } from '$lib/server/mileageService';
import { makeTripService } from '$lib/server/tripService';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { getStorageId } from '$lib/server/user';
import { calculateFuelCost } from '$lib/utils/calculations';

export const DELETE: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user as
			| { id?: string; name?: string; token?: string }
			| undefined;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		let env: any;
		try {
			env = getEnv(event.platform as any);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		const id = event.params.id;
		const userId = getStorageId(sessionUser);
		const legacyUserId = sessionUser.name; // For legacy key lookup
		const svc = makeMileageService(
			safeKV(env, 'BETA_MILLAGE_KV')!,
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeKV(env, 'BETA_LOGS_KV')
		);

		// Get the mileage log before deleting to check for linked trip
		const existing = await svc.get(userId, id, legacyUserId);

		// Soft delete via service
		await svc.delete(userId, id, legacyUserId);

		// --- Set linked trip's totalMiles to 0 and recalculate fuelCost ---
		if (existing && existing.tripId) {
			try {
				const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO')!;
				const placesIndexDO = safeDO(env, 'PLACES_INDEX_DO') || tripIndexDO;
				const tripSvc = makeTripService(
					safeKV(env, 'BETA_LOGS_KV')!,
					undefined,
					safeKV(env, 'BETA_PLACES_KV'),
					tripIndexDO,
					placesIndexDO
				);
				const trip = await tripSvc.get(userId, existing.tripId);
				if (trip && !trip.deleted) {
					trip.totalMiles = 0;
					// Also reset fuelCost since there are no miles
					(trip as any).fuelCost = 0;
					trip.updatedAt = new Date().toISOString();
					await tripSvc.put(trip);
					log.info('Set trip totalMiles and fuelCost to 0 after mileage delete', {
						tripId: existing.tripId
					});
				}
			} catch (e) {
				log.warn('Failed to update trip after mileage delete', {
					tripId: existing.tripId,
					message: createSafeErrorMessage(e)
				});
			}
		}

		return new Response(null, { status: 204 });
	} catch (err) {
		log.error('DELETE /api/mileage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const GET: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user as
			| { id?: string; name?: string; token?: string }
			| undefined;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		let env: any;
		try {
			env = getEnv(event.platform as any);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		const id = event.params.id;
		const userId = getStorageId(sessionUser);
		const legacyUserId = sessionUser.name; // For legacy key lookup
		const svc = makeMileageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const item = await svc.get(userId, id, legacyUserId);
		if (!item) return new Response('Not found', { status: 404 });
		return new Response(JSON.stringify(item), { headers: { 'Content-Type': 'application/json' } });
	} catch (err) {
		log.error('GET /api/mileage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user as
			| { id?: string; name?: string; token?: string }
			| undefined;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		let env: any;
		try {
			env = getEnv(event.platform as any);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		const id = event.params.id;
		const userId = getStorageId(sessionUser);

		const svc = makeMileageService(safeKV(env, 'BETA_MILLAGE_KV')!, safeDO(env, 'TRIP_INDEX_DO')!);
		const existing = await svc.get(userId, id);
		if (!existing) return new Response('Not found', { status: 404 });

		// Read the request body early so we can validate attaching to a trip if requested
		const body: any = await event.request.json();

		// Validate parent trip exists and is active when attaching or updating a tripId,
		// or if an existing trip record is present for this mileage id (legacy behavior: id == trip id)
		const tripKV = safeKV(env, 'BETA_LOGS_KV');
		const tripIdToCheck = body.tripId ?? existing.tripId ?? undefined;
		if (tripKV && typeof (tripKV as any).get === 'function') {
			if (tripIdToCheck) {
				// Validate the explicit tripId we're attaching/updating
				const tripKey = `trip:${userId}:${tripIdToCheck}`;
				const tripRaw = await tripKV.get(tripKey);

				if (!tripRaw) {
					return new Response(
						JSON.stringify({ error: 'Parent trip not found. Cannot update mileage log.' }),
						{ status: 409, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const trip = JSON.parse(tripRaw);
				if (trip.deleted) {
					return new Response(
						JSON.stringify({
							error: 'Parent trip is deleted. Cannot update mileage log for deleted trip.'
						}),
						{ status: 409, headers: { 'Content-Type': 'application/json' } }
					);
				}
			} else {
				// No explicit tripId provided — check if a trip record exists for this mileage ID (legacy behavior)
				const tripKey = `trip:${userId}:${id}`;
				const tripRaw = await tripKV.get(tripKey);
				if (tripRaw) {
					const trip = JSON.parse(tripRaw);
					if (trip.deleted) {
						return new Response(
							JSON.stringify({
								error: 'Parent trip is deleted. Cannot update mileage log for deleted trip.'
							}),
							{ status: 409, headers: { 'Content-Type': 'application/json' } }
						);
					}
				}
			}
		}

		// Merge existing with update
		const updated = {
			...existing,
			...body,
			userId, // Ensure userId cannot be changed
			id, // Ensure ID cannot be changed
			updatedAt: new Date().toISOString()
		};

		// Re-calculate fields if inputs changed — but respect an explicitly provided `miles`.
		const bodyHasMiles = Object.prototype.hasOwnProperty.call(body, 'miles');

		if (
			!bodyHasMiles &&
			typeof updated.startOdometer === 'number' &&
			typeof updated.endOdometer === 'number'
		) {
			updated.miles = Math.max(0, updated.endOdometer - updated.startOdometer);
			updated.miles = Number((updated.miles || 0).toFixed(2));
		} else if (bodyHasMiles && typeof updated.miles === 'number') {
			// Respect and normalize an explicitly provided miles value
			updated.miles = Number(updated.miles.toFixed(2));
		}

		// Recompute reimbursement when appropriate (respect explicit `reimbursement`)
		const bodyHasReimbursement = Object.prototype.hasOwnProperty.call(body, 'reimbursement');
		if (!bodyHasReimbursement && typeof updated.miles === 'number') {
			let rate = typeof updated.mileageRate === 'number' ? updated.mileageRate : undefined;
			if (rate == null) {
				try {
					const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
					if (userSettingsKV) {
						const raw = await userSettingsKV.get(`settings:${userId}`);
						if (raw) {
							const parsed = JSON.parse(raw as string);
							rate = parsed?.mileageRate;
						}
					}
				} catch {
					/* ignore */
				}
			}
			if (typeof rate === 'number')
				updated.reimbursement = Number((updated.miles * rate).toFixed(2));
		}

		if (typeof updated.reimbursement === 'number') {
			updated.reimbursement = Number(updated.reimbursement.toFixed(2));
		}

		if (typeof updated.mileageRate === 'number') {
			updated.mileageRate = Number(updated.mileageRate);
		}

		if (updated.vehicle === '') updated.vehicle = undefined;

		// Persist authoritative mileage
		await svc.put(updated);

		// --- Bidirectional sync: Update linked trip's totalMiles ---
		if (updated.tripId && typeof updated.miles === 'number') {
			try {
				const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO')!;
				const placesIndexDO = safeDO(env, 'PLACES_INDEX_DO') || tripIndexDO;
				const tripSvc = makeTripService(
					safeKV(env, 'BETA_LOGS_KV')!,
					undefined,
					safeKV(env, 'BETA_PLACES_KV'),
					tripIndexDO,
					placesIndexDO
				);
				const trip = await tripSvc.get(userId, updated.tripId);
				if (trip && !trip.deleted) {
					trip.totalMiles = updated.miles;
					// Recalculate fuel cost based on updated miles using shared utility
					const tripAny = trip as any;
					const mpg = Number(tripAny.mpg) || 0;
					const gasPrice = Number(tripAny.gasPrice) || 0;
					tripAny.fuelCost = calculateFuelCost(updated.miles, mpg, gasPrice);
					trip.updatedAt = new Date().toISOString();
					await tripSvc.put(trip);
					log.info('Updated trip totalMiles and fuelCost from mileage log', {
						tripId: updated.tripId,
						miles: updated.miles,
						fuelCost: tripAny.fuelCost
					});
				}
			} catch (e) {
				log.warn('Failed to sync mileage to trip', {
					tripId: updated.tripId,
					message: createSafeErrorMessage(e)
				});
			}
		}

		return new Response(JSON.stringify(updated), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/mileage/[id] error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
