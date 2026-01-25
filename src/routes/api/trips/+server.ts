// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import { findUserById } from '$lib/server/userService';
import { z } from 'zod';
import { PLAN_LIMITS } from '$lib/constants';
import {
	checkRateLimitEnhanced,
	createRateLimitHeaders,
	getClientIdentifier,
	isAuthenticated,
	RATE_LIMITS
} from '$lib/server/rateLimit';
import {
	validateAndSanitizeRequest,
	sanitizeQueryParam,
	createSafeErrorMessage
} from '$lib/server/sanitize';
import { log } from '$lib/server/log';
import type { TripRecord } from '$lib/server/tripService';
import { computeAndCacheDirections } from '$lib/server/directionsCache';

import { safeKV, safeDO } from '$lib/server/env';

// Type guard for location objects returned from clients/places
function isLatLng(obj: unknown): obj is { lat: number; lng: number } {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		typeof (obj as Record<string, unknown>)['lat'] === 'number' &&
		typeof (obj as Record<string, unknown>)['lng'] === 'number'
	);
}

const latLngSchema = z
	.object({
		lat: z.number(),
		lng: z.number()
	})
	.optional();

const destinationSchema = z.object({
	address: z.string().max(500).optional().default(''),
	earnings: z.number().optional().default(0),
	location: latLngSchema
});

const stopSchema = z.object({
	id: z.string().optional(),
	address: z.string().max(500).optional(),
	earnings: z.number().optional(),
	notes: z.string().max(1000).optional(),
	order: z.number().optional(),
	location: latLngSchema
});

const costItemSchema = z.object({
	id: z.string().optional(),
	type: z.string().max(100).optional(),
	item: z.string().max(100).optional(),
	cost: z.number().optional()
});

const tripSchema = z.object({
	id: z.string().uuid().optional(),
	date: z.string().optional(),
	// Optional pay date only used for taxes
	payDate: z.string().optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
	hoursWorked: z.number().optional(),
	startAddress: z.string().max(500).optional(),
	startLocation: latLngSchema,
	endAddress: z.string().max(500).optional(),
	endLocation: latLngSchema,
	totalMiles: z.number().nonnegative().optional(),
	estimatedTime: z.number().optional(),
	totalTime: z.string().optional(),
	mpg: z.number().positive().optional(),
	gasPrice: z.number().nonnegative().optional(),
	fuelCost: z.number().optional(),
	maintenanceCost: z.number().optional(),
	suppliesCost: z.number().optional(),
	totalEarnings: z.number().optional(),
	// NOTE: netProfit is calculated server-side, removed from schema to prevent client manipulation
	notes: z.string().max(1000).optional(),
	stops: z.array(stopSchema).optional(),
	destinations: z.array(destinationSchema).optional(),
	maintenanceItems: z.array(costItemSchema).optional(),
	suppliesItems: z.array(costItemSchema).optional(),
	lastModified: z.string().optional()
});

// Calculate net profit server-side (SECURITY: never trust client calculations)
function calculateNetProfit(trip: Record<string, unknown>): number {
	const earnings = Number(trip['totalEarnings']) || 0;
	const fuel = Number(trip['fuelCost']) || 0;
	const maintenance = Number(trip['maintenanceCost']) || 0;
	const supplies = Number(trip['suppliesCost']) || 0;
	return earnings - fuel - maintenance - supplies;
}

// Strongly typed aliases from Zod schemas
type TripInput = z.infer<typeof tripSchema>;
type StopInput = z.infer<typeof stopSchema>;
type CostItemInput = z.infer<typeof costItemSchema>;

interface SessionUser {
	id: string;
	plan?: 'free' | 'premium' | 'pro' | 'business';
	name?: string;
	token?: string;
}

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
	// Fallback: fire-and-forget
	void p;
}

// Build a sanitized TripRecord for storage (prevent mass-assignment)
function buildTripForSave(
	validData: TripInput,
	id: string,
	storageId: string,
	existing?: Partial<TripRecord>
): TripRecord {
	const now = new Date().toISOString();
	return {
		id,
		userId: storageId,
		date: validData.date,
		payDate: validData.payDate,
		startTime: validData.startTime,
		endTime: validData.endTime,
		hoursWorked: validData.hoursWorked,
		startAddress: validData.startAddress,
		startLocation: isLatLng(validData.startLocation) ? validData.startLocation : undefined,
		endAddress: validData.endAddress,
		endLocation: isLatLng(validData.endLocation) ? validData.endLocation : undefined,
		totalMiles: validData.totalMiles,
		estimatedTime: validData.estimatedTime,
		totalTime: validData.totalTime,
		fuelCost: validData.fuelCost,
		maintenanceCost: validData.maintenanceCost,
		suppliesCost: validData.suppliesCost,
		totalEarnings: validData.totalEarnings,
		stops: Array.isArray(validData.stops)
			? (validData.stops as StopInput[]).map((s) => ({
					id: s.id ?? crypto.randomUUID(),
					address: s.address ?? '',
					earnings: s.earnings,
					notes: s.notes,
					order: s.order ?? 0,
					location: s.location as { lat: number; lng: number } | undefined
				}))
			: undefined,
		destinations: Array.isArray(validData.destinations)
			? (
					validData.destinations as { address: string; location?: { lat: number; lng: number } }[]
				).map((d) => ({
					address: d.address,
					location: isLatLng(d.location) ? d.location : undefined
				}))
			: undefined,
		maintenanceItems: Array.isArray(validData.maintenanceItems)
			? (validData.maintenanceItems as CostItemInput[])
			: undefined,
		suppliesItems: Array.isArray(validData.suppliesItems)
			? (validData.suppliesItems as CostItemInput[])
			: undefined,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		lastModified: now,
		netProfit: calculateNetProfit(validData as Record<string, unknown>)
	};
}

// Merge and update trip from incoming validated data (prevent mass-assignment)
function mergeTripForUpdate(
	existing: TripRecord,
	validData: TripInput,
	storageId: string
): TripRecord {
	const now = new Date().toISOString();
	return {
		...existing,
		date: validData.date ?? existing.date,
		payDate: validData.payDate ?? existing.payDate,
		startTime: validData.startTime ?? existing.startTime,
		endTime: validData.endTime ?? existing.endTime,
		hoursWorked: validData.hoursWorked ?? existing.hoursWorked,
		startAddress: validData.startAddress ?? existing.startAddress,
		startLocation: isLatLng(validData.startLocation)
			? validData.startLocation
			: existing.startLocation,
		endAddress: validData.endAddress ?? existing.endAddress,
		endLocation: isLatLng(validData.endLocation) ? validData.endLocation : existing.endLocation,
		totalMiles: validData.totalMiles ?? existing.totalMiles,
		estimatedTime: validData.estimatedTime ?? existing.estimatedTime,
		totalTime: validData.totalTime ?? existing.totalTime,
		fuelCost: validData.fuelCost ?? existing.fuelCost,
		maintenanceCost: validData.maintenanceCost ?? existing.maintenanceCost,
		suppliesCost: validData.suppliesCost ?? existing.suppliesCost,
		totalEarnings: validData.totalEarnings ?? existing.totalEarnings,
		stops: Array.isArray(validData.stops)
			? (validData.stops as StopInput[]).map((s) => ({
					id: s.id ?? crypto.randomUUID(),
					address: s.address ?? '',
					earnings: s.earnings,
					notes: s.notes,
					order: s.order ?? 0,
					location: isLatLng(s.location) ? (s.location as { lat: number; lng: number }) : undefined
				}))
			: existing.stops,
		destinations: Array.isArray(validData.destinations)
			? (validData.destinations as { address: string; location?: { lat: number; lng: number } }[])
			: existing.destinations,
		maintenanceItems: Array.isArray(validData.maintenanceItems)
			? (validData.maintenanceItems as CostItemInput[])
			: existing.maintenanceItems,
		suppliesItems: Array.isArray(validData.suppliesItems)
			? (validData.suppliesItems as CostItemInput[])
			: existing.suppliesItems,
		userId: storageId,
		updatedAt: now,
		lastModified: now,
		netProfit: calculateNetProfit(validData as Record<string, unknown>)
	};
}

function getEnv(platform: App.Platform | undefined): App.Env {
	const env = platform?.env;

	if (!env || !safeKV(env, 'BETA_LOGS_KV') || !safeDO(env, 'TRIP_INDEX_DO')) {
		log.error('CRITICAL: Missing BETA_LOGS_KV or TRIP_INDEX_DO bindings');
		throw new Error('Database bindings missing');
	}

	return env as App.Env;
}

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user as SessionUser | undefined;
		if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

		let env: App.Env;
		try {
			env = getEnv(event.platform);
		} catch {
			return new Response('Service Unavailable', { status: 503 });
		}

		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
		if (sessionsKV) {
			const identifier = getClientIdentifier(event.request, event.locals);
			const authenticated = isAuthenticated(event.locals);
			const config = authenticated ? RATE_LIMITS.TRIPS_AUTH : RATE_LIMITS.TRIPS_ANON;

			const rateLimitResult = await checkRateLimitEnhanced(
				sessionsKV,
				identifier,
				'trips:read',
				config.limit,
				config.windowMs
			);

			const headers = createRateLimitHeaders(rateLimitResult);

			if (!rateLimitResult.allowed) {
				return new Response(
					JSON.stringify({
						error: 'Too many requests. Please try again later.',
						limit: rateLimitResult.limit,
						resetAt: rateLimitResult.resetAt
					}),
					{
						status: 429,
						headers: {
							'Content-Type': 'application/json',
							...headers
						}
					}
				);
			}
		}

		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = user?.id || '';
		let sinceParam = sanitizeQueryParam(event.url.searchParams.get('since'), 50);

		// Add a small buffer to the sinceParam to account for client clock skew (5 minutes)
		if (sinceParam) {
			try {
				const bufMs = 5 * 60 * 1000; // 5 minutes
				const s = new Date(sinceParam);
				s.setTime(s.getTime() - bufMs);
				// If client sent a future time (clock ahead), clamp to now - buffer
				const now = Date.now();
				if (s.getTime() > now) {
					log.info('[GET /api/trips] since param in future; clamping to now - buffer', {
						storageId,
						original: sinceParam,
						clamped: new Date(now - bufMs).toISOString()
					});
					s.setTime(now - bufMs);
				}
				sinceParam = s.toISOString();
			} catch {
				// if parsing fails, leave sinceParam as-is
			}
		}

		// --- ENFORCE DATA RETENTION FOR FREE USERS ---
		if (user.plan === 'free') {
			const retentionDate = new Date();
			retentionDate.setDate(retentionDate.getDate() - PLAN_LIMITS.FREE.RETENTION_DAYS);
			const retentionIso = retentionDate.toISOString();

			// If client asks for data older than retention allows (or asks for "all time"), override it
			if (!sinceParam || sinceParam < retentionIso) {
				sinceParam = retentionIso;
			}
		}

		const limitParam = event.url.searchParams.get('limit');
		const offsetParam = event.url.searchParams.get('offset');
		const limit = limitParam ? parseInt(limitParam) : undefined;
		const offset = offsetParam ? parseInt(offsetParam) : undefined;

		const svc = makeTripService(
			safeKV(env, 'BETA_LOGS_KV')!,
			undefined,
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const allTrips = await svc.list(storageId, { since: sinceParam, limit, offset });

		// If mileage KV is available, treat mileage as the source-of-truth and merge
		try {
			const mileageKV = safeKV(env, 'BETA_MILEAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(mileageKV, safeDO(env, 'TRIP_INDEX_DO')!);
				const ms = (await mileageSvc.list(storageId)) as MileageRecord[];
				const mById = new Map(ms.map((m: MileageRecord) => [m.id, m]));
				for (const t of allTrips) {
					const m = mById.get(t.id);
					if (m && typeof m.miles === 'number') t.totalMiles = m.miles;
				}
			}
		} catch (err) {
			log.warn('Failed to merge mileage into trips response', err);
		}

		return new Response(JSON.stringify(allTrips), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('GET /api/trips error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		const sessionUserSafe = sessionUser as
			| {
					id?: string;
					name?: string;
					token?: string;
					plan?: 'free' | 'premium' | 'pro' | 'business';
			  }
			| undefined;

		let env: App.Env;
		try {
			env = getEnv(event.platform);
		} catch {
			return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
		}

		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
		if (sessionsKV) {
			const identifier = getClientIdentifier(event.request, event.locals);
			const authenticated = isAuthenticated(event.locals);
			const config = authenticated ? RATE_LIMITS.TRIPS_AUTH : RATE_LIMITS.TRIPS_ANON;

			const rateLimitResult = await checkRateLimitEnhanced(
				sessionsKV,
				identifier,
				'trips:write',
				config.limit,
				config.windowMs
			);

			const headers = createRateLimitHeaders(rateLimitResult);

			if (!rateLimitResult.allowed) {
				return new Response(
					JSON.stringify({
						error: 'Too many requests. Please try again later.',
						limit: rateLimitResult.limit,
						resetAt: rateLimitResult.resetAt
					}),
					{
						status: 429,
						headers: {
							'Content-Type': 'application/json',
							...headers
						}
					}
				);
			}
		}

		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = sessionUserSafe?.id || '';
		const rawBody = (await event.request.json()) as unknown;

		let sanitizedBody;
		try {
			sanitizedBody = validateAndSanitizeRequest(rawBody, true);
		} catch (sanitizeError) {
			log.warn('Sanitization error', { message: createSafeErrorMessage(sanitizeError) });
			return new Response(
				JSON.stringify({
					error: 'Invalid input data',
					message: 'The submitted data contains invalid or potentially harmful content'
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const parseResult = tripSchema.safeParse(sanitizedBody);
		if (!parseResult.success) {
			return new Response(
				JSON.stringify({
					error: 'Invalid Data',
					details: parseResult.error.flatten()
				}),
				{ status: 400 }
			);
		}

		const svc = makeTripService(
			safeKV(env, 'BETA_LOGS_KV')!,
			undefined,
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const validData = parseResult.data;
		const id = validData.id || crypto.randomUUID();

		// Sanity check: warn if stops exist but addresses are empty (helps catch client-side payload issues)
		try {
			if (Array.isArray(validData.stops)) {
				const stops = validData.stops as StopInput[];
				const missing = stops.filter((s) => !s || !s.address || String(s.address).trim() === '');
				if (missing.length > 0) {
					log.warn('POST /api/trips: some stops missing address after sanitization', {
						tripId: id,
						missingCount: missing.length,
						sample: stops.slice(0, 5)
					});
				}
			}
		} catch (e) {
			log.warn('POST /api/trips: sanity check failed', { message: createSafeErrorMessage(e) });
		}
		let existingTrip: TripRecord | null = null;

		if (validData.id) {
			existingTrip = await svc.get(storageId, id);
		}

		let currentPlan = sessionUserSafe?.plan as unknown as
			| 'free'
			| 'premium'
			| 'pro'
			| 'business'
			| undefined;
		const usersKV = safeKV(env, 'BETA_USERS_KV');
		if (usersKV) {
			try {
				const freshUser = await findUserById(usersKV, sessionUserSafe?.id ?? '');
				if (freshUser) currentPlan = freshUser.plan;
			} catch (e) {
				log.warn('Failed to fetch fresh plan', { message: createSafeErrorMessage(e) });
			}
		}

		// --- ENFORCE STOP LIMIT FOR FREE USERS ---
		if (currentPlan === 'free') {
			const stopCount = validData.stops ? validData.stops.length : 0;
			if (stopCount > PLAN_LIMITS.FREE.MAX_STOPS) {
				return new Response(
					JSON.stringify({
						error: 'Plan Limit Exceeded',
						message: `The Free plan is limited to ${PLAN_LIMITS.FREE.MAX_STOPS} stops per trip. Please upgrade to add more.`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		// --- ATOMIC QUOTA CHECK via Durable Object (prevents race conditions) ---
		if (!existingTrip) {
			if (currentPlan === 'free') {
				const allowed =
					PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10;

				// Use atomic check-and-increment in Durable Object to prevent race conditions
				// This increments the counter atomically and returns whether it was allowed
				const quotaResult = await svc.checkMonthlyQuota(storageId, allowed);

				if (!quotaResult.allowed) {
					return new Response(
						JSON.stringify({
							error: 'Limit Reached',
							message: `You have reached your free limit of ${allowed} trips this month (Used: ${quotaResult.count}).`
						}),
						{ status: 403, headers: { 'Content-Type': 'application/json' } }
					);
				}
				// Note: Counter was already incremented atomically by checkMonthlyQuota
			}
		}
		const now = new Date().toISOString();

		// Build explicit TripRecord (prevent mass-assignment)
		const trip = buildTripForSave(validData, id, storageId, existingTrip ?? undefined);

		// Persist trip
		await svc.put(trip);

		// --- Auto-create mileage log if trip has totalMiles > 0 ---
		// ...continue...
		if (typeof validData.totalMiles === 'number' && validData.totalMiles > 0 && !existingTrip) {
			try {
				const mileageKV = safeKV(env, 'BETA_MILEAGE_KV');
				if (mileageKV) {
					const mileageSvc = makeMileageService(mileageKV, safeDO(env, 'TRIP_INDEX_DO')!);

					// Fetch user settings for mileageRate and vehicle
					let mileageRate: number | undefined;
					let vehicle: string | undefined;
					const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
					if (userSettingsKV && sessionUserSafe?.id) {
						try {
							const settingsRaw = await userSettingsKV.get(`settings:${sessionUserSafe.id}`);
							if (settingsRaw) {
								const settings = JSON.parse(settingsRaw);
								mileageRate =
									typeof settings.mileageRate === 'number' ? settings.mileageRate : undefined;
								const firstVehicle = settings.vehicles?.[0];
								vehicle = firstVehicle?.id ?? firstVehicle?.name ?? undefined;
							}
						} catch (e) {
							log.warn('Failed to fetch user settings for mileage', {
								message: createSafeErrorMessage(e)
							});
						}
					}

					// Calculate reimbursement if mileageRate is available
					const reimbursement =
						typeof mileageRate === 'number'
							? Number((validData.totalMiles * mileageRate).toFixed(2))
							: undefined;

					const mileageRecord = {
						id: trip.id, // Use trip ID for 1:1 linking
						tripId: trip.id,
						userId: storageId,
						date: trip.date || now,
						miles: validData.totalMiles,
						mileageRate,
						vehicle,
						reimbursement,
						notes: 'Auto-created from trip',
						createdAt: now,
						updatedAt: now,
						syncStatus: 'synced' as const
					};
					await mileageSvc.put(mileageRecord);
					log.info('Auto-created mileage log for trip', {
						tripId: trip.id,
						miles: validData.totalMiles
					});
				}
			} catch (e) {
				log.warn('Failed to auto-create mileage log', {
					tripId: trip.id,
					message: createSafeErrorMessage(e)
				});
			}
		}

		// --- Direct compute & KV writes (bypass TripIndexDO)
		try {
			const directionsKV = safeKV(env, 'BETA_DIRECTIONS_KV');
			if (directionsKV) {
				const p = computeAndCacheDirections(env, trip).catch((e: unknown) => {
					const msg = e instanceof Error ? e.message : String(e);
					log.warn('Direct compute failed', { message: msg });
				});
				safeWaitUntil(event, p);
			}
		} catch (e) {
			log.warn('Direct compute scheduling failed', { message: (e as Error).message });
		}

		// --- Enqueue route computation in TripIndexDO (non-blocking)
		try {
			const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO');
			if (tripIndexDO) {
				const id = tripIndexDO.idFromName(trip.userId);
				const stub = tripIndexDO.get(id);
				const computeReq = stub.fetch('http://internal/compute-routes', {
					method: 'POST',
					body: JSON.stringify({ id: trip.id })
				});
				// Prefer using platform.context.waitUntil to reliably schedule work after response
				try {
					safeWaitUntil(event, computeReq);
					log.info('Enqueued route computation', { tripId: trip.id });
				} catch (err) {
					// If waitUntil itself throws, still fallback
					log.warn('Failed to schedule compute job, continuing', { message: String(err) });
					void computeReq;
				}
			}
		} catch (e) {
			// Log but do not fail the request
			log.warn('Failed to enqueue route computation', { message: (e as Error).message });
		}

		if (!existingTrip) {
			await svc.incrementUserCounter(storageId, 1);
		}

		return new Response(JSON.stringify(trip), {
			status: 201,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('POST /api/trips error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

// PUT Handler for Updating existing trips
export const PUT: RequestHandler = async (event) => {
	try {
		const sessionUser = event.locals.user;
		if (!sessionUser) return new Response('Unauthorized', { status: 401 });

		const sessionUserSafe = sessionUser as
			| {
					id?: string;
					name?: string;
					token?: string;
					plan?: 'free' | 'premium' | 'pro' | 'business';
			  }
			| undefined;

		let env: App.Env;
		try {
			env = getEnv(event.platform);
		} catch {
			return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
		}

		// Rate Limiting (Same as POST)
		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
		if (sessionsKV) {
			const identifier = getClientIdentifier(event.request, event.locals);
			const authenticated = isAuthenticated(event.locals);
			const config = authenticated ? RATE_LIMITS.TRIPS_AUTH : RATE_LIMITS.TRIPS_ANON;

			const rateLimitResult = await checkRateLimitEnhanced(
				sessionsKV,
				identifier,
				'trips:write',
				config.limit,
				config.windowMs
			);

			if (!rateLimitResult.allowed) {
				return new Response(
					JSON.stringify({
						error: 'Too many requests.',
						limit: rateLimitResult.limit,
						resetAt: rateLimitResult.resetAt
					}),
					{ status: 429, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		// [!code fix] Strictly use ID. Prevents username spoofing.
		const storageId = sessionUserSafe?.id || '';
		const rawBody = (await event.request.json()) as unknown;

		let sanitizedBody;
		try {
			sanitizedBody = validateAndSanitizeRequest(rawBody, true);
		} catch (sanitizeError) {
			log.warn('Sanitization error', { message: createSafeErrorMessage(sanitizeError) });
			return new Response(JSON.stringify({ error: 'Invalid input data' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const parseResult = tripSchema.safeParse(sanitizedBody);
		if (!parseResult.success) {
			return new Response(
				JSON.stringify({
					error: 'Invalid Data',
					details: parseResult.error.flatten()
				}),
				{ status: 400 }
			);
		}

		const svc = makeTripService(
			safeKV(env, 'BETA_LOGS_KV')!,
			undefined,
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const validData = parseResult.data;
		if (!validData.id) {
			return new Response(JSON.stringify({ error: 'Trip ID required for updates' }), {
				status: 400
			});
		}

		// --- ENFORCE STOP LIMIT ON UPDATES ---
		if (sessionUserSafe?.plan === 'free') {
			const stopCount = validData.stops ? validData.stops.length : 0;
			if (stopCount > PLAN_LIMITS.FREE.MAX_STOPS) {
				return new Response(
					JSON.stringify({
						error: 'Plan Limit Exceeded',
						message: `The Free plan is limited to ${PLAN_LIMITS.FREE.MAX_STOPS} stops per trip.`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		const existingTrip = await svc.get(storageId, validData.id);
		if (!existingTrip) {
			return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
		}

		const now = new Date().toISOString();

		// CRITICAL: Force lastModified on Edit to trigger conflict detection next sync
		const trip = mergeTripForUpdate(existingTrip as TripRecord, validData, storageId);

		await svc.put(trip);

		// --- Bidirectional sync: Update linked mileage log if totalMiles changed ---
		if (
			typeof validData.totalMiles === 'number' &&
			existingTrip.totalMiles !== validData.totalMiles
		) {
			try {
				const mileageKV = safeKV(env, 'BETA_MILEAGE_KV');
				if (mileageKV) {
					const mileageSvc = makeMileageService(mileageKV, safeDO(env, 'TRIP_INDEX_DO')!);
					const allMileage = await mileageSvc.list(storageId);
					const linkedMileage = allMileage.find((m: MileageRecord) => m.tripId === trip.id);

					if (linkedMileage) {
						// Update existing mileage log
						linkedMileage.miles = validData.totalMiles;

						linkedMileage.updatedAt = now;
						await mileageSvc.put(linkedMileage);
						log.info('Updated mileage log from trip edit', {
							tripId: trip.id,
							miles: validData.totalMiles
						});
					} else if (validData.totalMiles > 0) {
						// Create new mileage log if none exists and miles > 0
						const newMileage = {
							id: crypto.randomUUID(),
							tripId: trip.id,
							userId: storageId,
							date: trip.date || now,

							miles: validData.totalMiles,
							notes: 'Auto-created from trip edit',
							createdAt: now,
							updatedAt: now,
							syncStatus: 'synced' as const
						};
						await mileageSvc.put(newMileage);
						log.info('Created mileage log from trip edit', {
							tripId: trip.id,
							miles: validData.totalMiles
						});
					}
				}
			} catch (e) {
				log.warn('Failed to sync trip mileage to mileage log', {
					tripId: trip.id,
					message: createSafeErrorMessage(e)
				});
			}
		}

		// --- Enqueue route computation in TripIndexDO (non-blocking)
		try {
			const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO');
			if (tripIndexDO) {
				const id = tripIndexDO.idFromName(trip.userId);
				const stub = tripIndexDO.get(id);
				void stub.fetch('http://internal/compute-routes', {
					method: 'POST',
					body: JSON.stringify({ id: trip.id })
				});
			}
		} catch (e) {
			log.warn('Failed to enqueue route computation', { message: (e as Error).message });
		}

		return new Response(JSON.stringify(trip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		log.error('PUT /api/trips error', { message: createSafeErrorMessage(err) });
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
