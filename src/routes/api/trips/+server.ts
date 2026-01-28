// src/routes/api/trips/+server.ts
import { PLAN_LIMITS } from '$lib/constants';
import { computeAndCacheDirections } from '$lib/server/directionsCache';
// expenseService removed: auto-created trip expenses were removed per feature change
import { makeExpenseService, type ExpenseRecord } from '$lib/server/expenseService';
import { log } from '$lib/server/log';
import { makeMileageService, type MileageRecord } from '$lib/server/mileageService';
import {
	checkRateLimitEnhanced,
	createRateLimitHeaders,
	getClientIdentifier,
	isAuthenticated,
	RATE_LIMITS
} from '$lib/server/rateLimit';
import {
	createSafeErrorMessage,
	sanitizeQueryParam,
	validateAndSanitizeRequest
} from '$lib/server/sanitize';
import type { TripRecord } from '$lib/server/tripService';
import { makeTripService } from '$lib/server/tripService';
import { findUserById } from '$lib/server/userService';
import { calculateFuelCost } from '$lib/utils/calculations';
import { z } from 'zod';
import type { RequestHandler } from './$types';

import { safeDO, safeKV } from '$lib/server/env';
/* eslint-disable @typescript-eslint/no-explicit-any */

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
	.nullable()
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
	const outBase: Partial<TripRecord> = { id, userId: storageId };
	// Attach only defined fields to satisfy exactOptionalPropertyTypes
	if (typeof validData.date === 'string') outBase.date = validData.date;
	if (typeof validData.payDate === 'string') outBase.payDate = validData.payDate;
	if (typeof validData.startTime === 'string') outBase.startTime = validData.startTime;
	if (typeof validData.endTime === 'string') outBase.endTime = validData.endTime;
	if (typeof validData.hoursWorked === 'number') outBase.hoursWorked = validData.hoursWorked;
	if (typeof validData.startAddress === 'string') outBase.startAddress = validData.startAddress;
	if (isLatLng(validData.startLocation)) outBase.startLocation = validData.startLocation;
	if (typeof validData.endAddress === 'string') outBase.endAddress = validData.endAddress;
	if (isLatLng(validData.endLocation)) outBase.endLocation = validData.endLocation;
	if (typeof validData.totalMiles === 'number') outBase.totalMiles = validData.totalMiles;
	if (typeof validData.estimatedTime === 'number') outBase.estimatedTime = validData.estimatedTime;
	if (typeof validData.totalTime === 'string') outBase.totalTime = validData.totalTime;
	if (typeof validData.fuelCost === 'number') outBase.fuelCost = validData.fuelCost;
	if (typeof validData.maintenanceCost === 'number')
		outBase.maintenanceCost = validData.maintenanceCost;
	if (typeof validData.suppliesCost === 'number') outBase.suppliesCost = validData.suppliesCost;
	if (typeof validData.totalEarnings === 'number') outBase.totalEarnings = validData.totalEarnings;
	// stops are added conditionally below to avoid setting undefined on the object literal
	/* stops will be attached below if provided */
	if (Array.isArray(validData.destinations)) {
		outBase.destinations = (
			validData.destinations as { address: string; location?: { lat: number; lng: number } }[]
		).map((d) => {
			const rec: { address: string; location?: { lat: number; lng: number } } = {
				address: d.address
			};
			if (isLatLng(d.location)) rec.location = d.location;
			return rec;
		});
	}
	if (Array.isArray(validData.maintenanceItems))
		outBase.maintenanceItems = validData.maintenanceItems as CostItemInput[];
	if (Array.isArray(validData.suppliesItems))
		outBase.suppliesItems = validData.suppliesItems as CostItemInput[];
	outBase.createdAt = existing?.createdAt ?? now;
	outBase.updatedAt = now;
	outBase.lastModified = now;
	outBase.netProfit = calculateNetProfit(validData as Record<string, unknown>);

	// Attach stops conditionally to avoid setting undefined on the literal
	if (Array.isArray(validData.stops)) {
		const mappedStops = (validData.stops as StopInput[]).map((s) => {
			const rec: {
				id: string;
				address: string;
				earnings?: number;
				notes?: string;
				order: number;
				location?: { lat: number; lng: number };
			} = {
				id: s.id ?? crypto.randomUUID(),
				address: s.address ?? '',
				order: s.order ?? 0
			};
			if (s.earnings !== undefined) rec.earnings = s.earnings;
			if (s.notes) rec.notes = s.notes;
			if (isLatLng(s.location)) rec.location = s.location;
			return rec;
		});
		// Attach mapped stops
		outBase.stops = mappedStops;
	}

	const out: TripRecord = outBase as TripRecord;
	return out;
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
		...(typeof validData.date === 'string' ? { date: validData.date } : {}),
		...(typeof validData.payDate === 'string' ? { payDate: validData.payDate } : {}),
		...(typeof validData.startTime === 'string' ? { startTime: validData.startTime } : {}),
		...(typeof validData.endTime === 'string' ? { endTime: validData.endTime } : {}),
		...(typeof validData.hoursWorked === 'number' ? { hoursWorked: validData.hoursWorked } : {}),
		...(typeof validData.startAddress === 'string' ? { startAddress: validData.startAddress } : {}),
		...(isLatLng(validData.startLocation) ? { startLocation: validData.startLocation } : {}),
		...(typeof validData.endAddress === 'string' ? { endAddress: validData.endAddress } : {}),
		...(isLatLng(validData.endLocation) ? { endLocation: validData.endLocation } : {}),
		...(typeof validData.totalMiles === 'number' ? { totalMiles: validData.totalMiles } : {}),
		...(typeof validData.estimatedTime === 'number'
			? { estimatedTime: validData.estimatedTime }
			: {}),
		...(typeof validData.totalTime === 'string' ? { totalTime: validData.totalTime } : {}),
		...(typeof validData.fuelCost === 'number' ? { fuelCost: validData.fuelCost } : {}),
		...(typeof validData.maintenanceCost === 'number'
			? { maintenanceCost: validData.maintenanceCost }
			: {}),
		...(typeof validData.suppliesCost === 'number' ? { suppliesCost: validData.suppliesCost } : {}),
		...(typeof validData.totalEarnings === 'number'
			? { totalEarnings: validData.totalEarnings }
			: {}),
		...(Array.isArray(validData.stops)
			? {
					stops: (validData.stops as StopInput[]).map((s) => {
						const rec: {
							id: string;
							address: string;
							earnings?: number;
							notes?: string;
							order: number;
							location?: { lat: number; lng: number };
						} = {
							id: s.id ?? crypto.randomUUID(),
							address: s.address ?? '',
							order: s.order ?? 0
						};
						if (typeof s.earnings === 'number') rec.earnings = s.earnings;
						if (typeof s.notes === 'string') rec.notes = s.notes;
						if (isLatLng(s.location)) rec.location = s.location as { lat: number; lng: number };
						return rec;
					})
				}
			: {}),
		...(Array.isArray(validData.destinations)
			? {
					destinations: (
						validData.destinations as { address: string; location?: { lat: number; lng: number } }[]
					).map((d) => ({
						address: d.address,
						...(isLatLng(d.location) ? { location: d.location } : {})
					}))
				}
			: {}),
		...(Array.isArray(validData.maintenanceItems)
			? { maintenanceItems: validData.maintenanceItems as CostItemInput[] }
			: {}),
		...(Array.isArray(validData.suppliesItems)
			? { suppliesItems: validData.suppliesItems as CostItemInput[] }
			: {}),
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
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const opts: { since?: string; limit?: number; offset?: number } = {};
		if (sinceParam) opts.since = sinceParam;
		if (typeof limit === 'number') opts.limit = limit;
		if (typeof offset === 'number') opts.offset = offset;
		const allTrips = await svc.list(storageId, opts);

		// If mileage KV is available, treat mileage as the source-of-truth and merge
		try {
			const mileageKV = safeKV(env, 'BETA_MILEAGE_KV');
			if (mileageKV) {
				const mileageSvc = makeMileageService(mileageKV, safeDO(env, 'TRIP_INDEX_DO')!);
				const ms = (await mileageSvc.list(storageId)) as MileageRecord[];
				const mById = new Map(ms.map((m: MileageRecord) => [m.id, m]));
				for (const t of allTrips) {
					const m = mById.get(t.id);
					if (m && typeof m.miles === 'number') {
						t.totalMiles = m.miles;
						// Only compute/attach fuelCost from mileage when the trip DOES NOT already
						// have an explicit non-zero fuelCost (prefer user-provided value).
						const hasExplicitFuel =
							typeof (t as Record<string, unknown>)['fuelCost'] === 'number' &&
							Number((t as Record<string, unknown>)['fuelCost']) > 0;
						if (!hasExplicitFuel) {
							try {
								const tripAny = t as unknown as Record<string, unknown>;
								const mpg = typeof tripAny['mpg'] === 'number' ? (tripAny['mpg'] as number) : 25;
								const gasPrice =
									typeof tripAny['gasPrice'] === 'number' ? (tripAny['gasPrice'] as number) : 3.5;
								(t as any).fuelCost = Number(calculateFuelCost(m.miles, mpg, gasPrice));
							} catch {
								/* ignore */
							}
						}
					}
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

		// --- If trip has totalMiles compute server-side fuelCost (so UI shows estimated fuel immediately) ---
		if (typeof validData.totalMiles === 'number' && validData.totalMiles > 0) {
			// Prefer explicit trip mpg/gasPrice from payload, fall back to sensible defaults
			const tripAny = trip as unknown as Record<string, unknown>;
			const mpg =
				typeof tripAny['mpg'] === 'number'
					? (tripAny['mpg'] as number)
					: typeof validData.mpg === 'number'
						? validData.mpg
						: 25;
			const gasPrice =
				typeof tripAny['gasPrice'] === 'number'
					? (tripAny['gasPrice'] as number)
					: typeof validData.gasPrice === 'number'
						? validData.gasPrice
						: 3.5;
			try {
				trip.fuelCost = Number(calculateFuelCost(validData.totalMiles, mpg, gasPrice));
			} catch {
				/* ignore */
			}
		}

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

					const base: Partial<import('$lib/server/mileageService').MileageRecord> = {
						id: trip.id, // Use trip ID for 1:1 linking
						tripId: trip.id,
						userId: storageId,
						date: trip.date || now,
						miles: validData.totalMiles,
						notes: 'Auto-created from trip',
						createdAt: now,
						updatedAt: now,
						syncStatus: 'synced' as const
					};
					if (typeof mileageRate === 'number') base.mileageRate = mileageRate;
					if (typeof vehicle === 'string') base.vehicle = vehicle;
					if (typeof reimbursement === 'number') base.reimbursement = reimbursement;
					const mileageRecord = base as import('$lib/server/mileageService').MileageRecord;

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

			// --- Auto-create expense records from trip
			try {
				const expenseKV = safeKV(env, 'BETA_EXPENSES_KV');
				if (expenseKV) {
					const expenseSvc = makeExpenseService(expenseKV, safeDO(env, 'TRIP_INDEX_DO')!);

					// Fuel
					if (typeof validData.fuelCost === 'number' && validData.fuelCost > 0) {
						const fuelExpense = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Fuel',
							amount: Number(validData.fuelCost),
							description: 'Estimated Fuel Cost (auto-created from trip)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(fuelExpense as ExpenseRecord);
						log.info('Auto-created fuel expense from trip', {
							tripId: trip.id,
							amount: fuelExpense.amount
						});
					}

					// Maintenance items (per-item) or aggregate
					if (Array.isArray(validData.maintenanceItems) && validData.maintenanceItems.length > 0) {
						for (const it of validData.maintenanceItems as CostItemInput[]) {
							const amt = Number(it.cost) || 0;
							if (amt <= 0) continue;
							const rec = {
								id: crypto.randomUUID(),
								userId: storageId,
								date: trip.date || now,
								category: 'Maintenance',
								amount: amt,
								description: it.type || it.item || 'Maintenance (auto-created from trip)',
								createdAt: now,
								updatedAt: now,
								tripId: trip.id,
								autoCreated: true
							};
							await expenseSvc.put(rec as any);
						}
					} else if (
						typeof validData.maintenanceCost === 'number' &&
						validData.maintenanceCost > 0
					) {
						const mrec = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Maintenance',
							amount: Number(validData.maintenanceCost),
							description: 'Estimated Maintenance (auto-created from trip)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(mrec as any);
					}

					// Supplies items (per-item) or aggregate
					if (Array.isArray(validData.suppliesItems) && validData.suppliesItems.length > 0) {
						for (const it of validData.suppliesItems as CostItemInput[]) {
							const amt = Number(it.cost) || 0;
							if (amt <= 0) continue;
							const rec = {
								id: crypto.randomUUID(),
								userId: storageId,
								date: trip.date || now,
								category: 'Supplies',
								amount: amt,
								description: it.type || it.item || 'Supplies (auto-created from trip)',
								createdAt: now,
								updatedAt: now,
								tripId: trip.id,
								autoCreated: true
							};
							await expenseSvc.put(rec as any);
						}
					} else if (typeof validData.suppliesCost === 'number' && validData.suppliesCost > 0) {
						const srec = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Supplies',
							amount: Number(validData.suppliesCost),
							description: 'Estimated Supplies (auto-created from trip)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(srec as any);
					}
				}
			} catch (e) {
				log.warn('Failed to auto-create expense(s) from trip', {
					tripId: trip.id,
					message: createSafeErrorMessage(e)
				});
			}

			// Auto-creation of expenses from trips has been removed.
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
						// Try to attach mileageRate/reimbursement from user settings if available
						try {
							const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
							if (userSettingsKV && sessionUserSafe?.id) {
								const settingsRaw = await userSettingsKV.get(`settings:${sessionUserSafe.id}`);
								if (settingsRaw) {
									const settings = JSON.parse(settingsRaw);
									if (typeof settings.mileageRate === 'number') {
										linkedMileage.mileageRate = settings.mileageRate;
										linkedMileage.reimbursement = Number(
											(Number(linkedMileage.miles) * settings.mileageRate).toFixed(2)
										);
									}
									const firstVehicle = settings.vehicles?.[0];
									if (firstVehicle?.id) linkedMileage.vehicle = firstVehicle.id;
									else if (firstVehicle?.name) linkedMileage.vehicle = firstVehicle.name;
								}
							}
						} catch {
							/* ignore */
						}

						linkedMileage.updatedAt = now;
						await mileageSvc.put(linkedMileage);
						log.info('Updated mileage log from trip edit', {
							tripId: trip.id,
							miles: validData.totalMiles
						});

						// Recompute trip fuelCost and persist if possible
						try {
							const tripAny = trip as unknown as Record<string, unknown>;
							const mpg = typeof tripAny['mpg'] === 'number' ? (tripAny['mpg'] as number) : 25;
							const gasPrice =
								typeof tripAny['gasPrice'] === 'number' ? (tripAny['gasPrice'] as number) : 3.5;
							trip.fuelCost = Number(calculateFuelCost(linkedMileage.miles || 0, mpg, gasPrice));
							await svc.put(trip);
						} catch {
							/* ignore */
						}
					} else if (validData.totalMiles > 0) {
						// Create new mileage log if none exists and miles > 0
						const newMileage: Partial<import('$lib/server/mileageService').MileageRecord> = {
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
						// Attach mileageRate/vehicle/reimbursement from user settings if available
						try {
							const userSettingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
							if (userSettingsKV && sessionUserSafe?.id) {
								const settingsRaw = await userSettingsKV.get(`settings:${sessionUserSafe.id}`);
								if (settingsRaw) {
									const settings = JSON.parse(settingsRaw);
									if (typeof settings.mileageRate === 'number') {
										newMileage.mileageRate = settings.mileageRate;
										newMileage.reimbursement = Number(
											(Number(newMileage.miles) * settings.mileageRate).toFixed(2)
										);
									}
									const firstVehicle = settings.vehicles?.[0];
									if (firstVehicle?.id) newMileage.vehicle = firstVehicle.id;
									else if (firstVehicle?.name) newMileage.vehicle = firstVehicle.name;
								}
							}
						} catch {
							/* ignore */
						}

						await mileageSvc.put(newMileage as import('$lib/server/mileageService').MileageRecord);
						log.info('Created mileage log from trip edit', {
							tripId: trip.id,
							miles: validData.totalMiles
						});

						// Recompute and persist trip fuelCost if possible
						try {
							const tripAny = trip as unknown as Record<string, unknown>;
							const mpg = typeof tripAny['mpg'] === 'number' ? (tripAny['mpg'] as number) : 25;
							const gasPrice =
								typeof tripAny['gasPrice'] === 'number' ? (tripAny['gasPrice'] as number) : 3.5;
							trip.fuelCost = Number(calculateFuelCost(newMileage.miles || 0, mpg, gasPrice));
							await svc.put(trip);
						} catch {
							/* ignore */
						}
					}
				}
			} catch (e) {
				log.warn('Failed to sync trip mileage to mileage log', {
					tripId: trip.id,
					message: createSafeErrorMessage(e)
				});
			}
		}

		// --- Bidirectional sync: Update/create linked expense records if cost fields changed ---
		try {
			const expenseKV = safeKV(env, 'BETA_EXPENSES_KV');
			if (expenseKV) {
				const expenseSvc = makeExpenseService(expenseKV, safeDO(env, 'TRIP_INDEX_DO')!);
				const allExpenses = await expenseSvc.list(storageId);

				// Fuel
				if (
					typeof validData.fuelCost === 'number' &&
					existingTrip.fuelCost !== validData.fuelCost
				) {
					const linked = allExpenses.find(
						(e: ExpenseRecord & { autoCreated?: boolean }) =>
							e.tripId === trip.id && e.category === 'Fuel' && e.autoCreated
					);
					if (linked) {
						linked.amount = Number(validData.fuelCost);
						linked.updatedAt = now;
						await expenseSvc.put(linked);
						log.info('Updated fuel expense from trip edit', {
							tripId: trip.id,
							amount: linked.amount
						});
					} else if (validData.fuelCost > 0) {
						const rec = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Fuel',
							amount: Number(validData.fuelCost),
							description: 'Estimated Fuel Cost (auto-created from trip edit)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(rec as any);
					}
				}

				// Maintenance: prefer per-item if present, else aggregate
				if (
					Array.isArray(validData.maintenanceItems) &&
					Array.isArray(existingTrip.maintenanceItems ? existingTrip.maintenanceItems : [])
				) {
					// Upsert per-item maintenance expenses
					for (const it of validData.maintenanceItems as CostItemInput[]) {
						const desc = it.type || it.item || 'Maintenance (auto-created from trip edit)';
						const amt = Number(it.cost) || 0;
						if (amt <= 0) continue;
						const linked = allExpenses.find(
							(e: ExpenseRecord & { autoCreated?: boolean }) =>
								e.tripId === trip.id &&
								e.category === 'Maintenance' &&
								e.autoCreated &&
								e.description === desc
						);
						if (linked) {
							linked.amount = amt;
							linked.updatedAt = now;
							await expenseSvc.put(linked);
						} else {
							const rec = {
								id: crypto.randomUUID(),
								userId: storageId,
								date: trip.date || now,
								category: 'Maintenance',
								amount: amt,
								description: desc,
								createdAt: now,
								updatedAt: now,
								tripId: trip.id,
								autoCreated: true
							};
							await expenseSvc.put(rec as any);
						}
					}
				} else if (
					typeof validData.maintenanceCost === 'number' &&
					existingTrip.maintenanceCost !== validData.maintenanceCost
				) {
					const linked = allExpenses.find(
						(e: ExpenseRecord & { autoCreated?: boolean }) =>
							e.tripId === trip.id && e.category === 'Maintenance' && e.autoCreated
					);
					if (linked) {
						linked.amount = Number(validData.maintenanceCost);
						linked.updatedAt = now;
						await expenseSvc.put(linked);
						log.info('Updated maintenance expense from trip edit', {
							tripId: trip.id,
							amount: linked.amount
						});
					} else if (validData.maintenanceCost > 0) {
						const rec = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Maintenance',
							amount: Number(validData.maintenanceCost),
							description: 'Estimated Maintenance (auto-created from trip edit)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(rec as any);
					}
				}

				// Supplies: per-item or aggregate (same pattern)
				if (
					Array.isArray(validData.suppliesItems) &&
					Array.isArray(existingTrip.suppliesItems ? existingTrip.suppliesItems : [])
				) {
					for (const it of validData.suppliesItems as CostItemInput[]) {
						const desc = it.type || it.item || 'Supplies (auto-created from trip edit)';
						const amt = Number(it.cost) || 0;
						if (amt <= 0) continue;
						const linked = allExpenses.find(
							(e: any) =>
								e.tripId === trip.id &&
								e.category === 'Supplies' &&
								e.autoCreated &&
								e.description === desc
						);
						if (linked) {
							linked.amount = amt;
							linked.updatedAt = now;
							await expenseSvc.put(linked);
						} else {
							const rec = {
								id: crypto.randomUUID(),
								userId: storageId,
								date: trip.date || now,
								category: 'Supplies',
								amount: amt,
								description: desc,
								createdAt: now,
								updatedAt: now,
								tripId: trip.id,
								autoCreated: true
							};
							await expenseSvc.put(rec as any);
						}
					}
				} else if (
					typeof validData.suppliesCost === 'number' &&
					existingTrip.suppliesCost !== validData.suppliesCost
				) {
					const linked = allExpenses.find(
						(e: ExpenseRecord & { autoCreated?: boolean }) =>
							e.tripId === trip.id && e.category === 'Supplies' && e.autoCreated
					);
					if (linked) {
						linked.amount = Number(validData.suppliesCost);
						linked.updatedAt = now;
						await expenseSvc.put(linked);
						log.info('Updated supplies expense from trip edit', {
							tripId: trip.id,
							amount: linked.amount
						});
					} else if (validData.suppliesCost > 0) {
						const rec = {
							id: crypto.randomUUID(),
							userId: storageId,
							date: trip.date || now,
							category: 'Supplies',
							amount: Number(validData.suppliesCost),
							description: 'Estimated Supplies (auto-created from trip edit)',
							createdAt: now,
							updatedAt: now,
							tripId: trip.id,
							autoCreated: true
						};
						await expenseSvc.put(rec as any);
					}
				}
			}
		} catch (e) {
			log.warn('Failed to sync trip expenses to expenses service', {
				tripId: trip.id,
				message: createSafeErrorMessage(e)
			});
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
