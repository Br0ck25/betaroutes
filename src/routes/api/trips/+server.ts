// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { makeMillageService } from '$lib/server/millageService';
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
	netProfit: z.number().optional(),
	notes: z.string().max(1000).optional(),
	stops: z.array(stopSchema).optional(),
	destinations: z.array(destinationSchema).optional(),
	maintenanceItems: z.array(costItemSchema).optional(),
	suppliesItems: z.array(costItemSchema).optional(),
	lastModified: z.string().optional()
});

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
		const user = event.locals.user as
			| {
					id?: string;
					name?: string;
					token?: string;
					plan?: 'free' | 'premium' | 'pro' | 'business';
			  }
			| undefined;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const userSafe = user as { name?: string; token?: string } | undefined;

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

		const storageId = userSafe?.name || userSafe?.token || '';
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

		// If millage KV is available, treat millage as the source-of-truth and merge
		try {
			const millageKV = safeKV(env, 'BETA_MILLAGE_KV');
			if (millageKV) {
				const millageSvc = makeMillageService(millageKV as any, safeDO(env, 'TRIP_INDEX_DO')!);
				const ms = await millageSvc.list(storageId);
				const mById = new Map(ms.map((m: any) => [m.id, m]));
				for (const t of allTrips) {
					const m = mById.get(t.id);
					if (m && typeof m.miles === 'number') t.totalMiles = m.miles;
				}
			}
		} catch (err) {
			log.warn('Failed to merge millage into trips response', err);
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

		const storageId = sessionUserSafe?.name || sessionUserSafe?.token || '';
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
			if (validData.stops && Array.isArray(validData.stops)) {
				const missing = (validData.stops as any[]).filter(
					(s) => !s || !s.address || String(s.address).trim() === ''
				);
				if (missing.length > 0) {
					log.warn('POST /api/trips: some stops missing address after sanitization', {
						tripId: id,
						missingCount: missing.length,
						sample: (validData.stops as any[]).slice(0, 5)
					});
				}
			}
		} catch (e) {
			log.warn('POST /api/trips: sanity check failed', e);
		}
		let existingTrip = null;

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

		if (!existingTrip) {
			if (currentPlan === 'free') {
				const windowDays = PLAN_LIMITS.FREE.WINDOW_DAYS || 30;
				const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
				const recentTrips = await svc.list(storageId, { since });
				const allowed =
					PLAN_LIMITS.FREE.MAX_TRIPS_PER_MONTH || PLAN_LIMITS.FREE.MAX_TRIPS_IN_WINDOW || 10;
				if (recentTrips.length >= allowed) {
					return new Response(
						JSON.stringify({
							error: 'Limit Reached',
							message: `You have reached your free limit of ${allowed} trips in the last ${windowDays} days (Used: ${recentTrips.length}).`
						}),
						{ status: 403, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}
		}
		const now = new Date().toISOString();

		// Set lastModified to mark this as a manual user update
		const trip = {
			...validData,
			id,
			userId: storageId,
			createdAt: existingTrip ? existingTrip.createdAt : now,
			updatedAt: now,
			lastModified: now // Critical for conflict detection
		};

		// Persist trip (coerce to TripRecord)
		await svc.put(trip as TripRecord);

		// Persist millage to dedicated KV (source-of-truth). Do not fail trip create if millage write fails.
		try {
			const millageKV = safeKV(env, 'BETA_MILLAGE_KV');
			if (millageKV && typeof trip.totalMiles === 'number') {
				const millageSvc = makeMillageService(millageKV as any, safeDO(env, 'TRIP_INDEX_DO')!);
				const millageRec: any = {
					id: trip.id,
					userId: storageId,
					date: trip.date,
					startOdometer: 0,
					endOdometer: 0,
					miles: Number(trip.totalMiles),
					createdAt: existingTrip ? existingTrip.createdAt : now,
					updatedAt: now
				};

				// If the client provided millageRate/vehicle include them; otherwise try to
				// read the user's settings KV for defaults (best-effort).
				if (typeof (trip as any).millageRate === 'number') {
					millageRec.millageRate = Number((trip as any).millageRate);
				}
				if ((trip as any).vehicle) {
					millageRec.vehicle = (trip as any).vehicle;
				} else {
					try {
						const settingsKV = safeKV(env, 'BETA_USER_SETTINGS_KV');
						if (settingsKV) {
							const raw = await settingsKV.get(`settings:${(sessionUserSafe as any).id}`);
							if (raw) {
								const s = JSON.parse(raw);
								if (s?.vehicles && s.vehicles[0])
									millageRec.vehicle = s.vehicles[0].id || s.vehicles[0].name;
								if (typeof s?.millageRate === 'number' && millageRec.millageRate == null)
									millageRec.millageRate = Number(s.millageRate);
							}
						}
					} catch (e) {
						// ignore
					}
				}
				const p = millageSvc
					.put(millageRec as any)
					.catch((err) => log.warn('millage.put failed for trip create', { tripId: trip.id, err }));
				try {
					if (event.platform?.context?.waitUntil) event.platform.context.waitUntil(p as any);
					else if ((event as any)?.context?.waitUntil) (event as any).context.waitUntil(p);
				} catch {
					void p;
				}
			}
		} catch (err) {
			log.warn('Failed to persist millage for trip create', {
				tripId: trip.id,
				message: createSafeErrorMessage(err)
			});
		}

		// --- Direct compute & KV writes (bypass TripIndexDO)
		try {
			const directionsKV = safeKV(env, 'BETA_DIRECTIONS_KV');
			if (directionsKV) {
				const p = computeAndCacheDirections(env, trip).catch((e: unknown) => {
					const msg = e instanceof Error ? e.message : String(e);
					log.warn('Direct compute failed', { message: msg });
				});
				try {
					if (event.platform?.context?.waitUntil) {
						event.platform.context.waitUntil(p as any);
					} else if ((event as any)?.context?.waitUntil) {
						(event as any).context.waitUntil(p);
					} else {
						// Fallback to fire-and-forget
						void p;
					}
				} catch {
					// ignore waitUntil failures
					void p;
				}
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
					if (event.platform?.context?.waitUntil) {
						event.platform.context.waitUntil(computeReq);
					} else if ((event as any)?.context?.waitUntil) {
						(event as any).context.waitUntil(computeReq);
					} else {
						// Fallback to fire-and-forget
						void computeReq;
					}
					log.info('Enqueued route computation', { tripId: trip.id });
				} catch (err) {
					// If waitUntil itself throws, still fallback
					log.warn('Failed to waitUntil compute job, continuing', { message: String(err) });
					void computeReq;
				}
			}
		} catch (e) {
			// Log but do not fail the request
			log.warn('Failed to enqueue route computation', { message: (e as Error).message });
		}

		if (!existingTrip) {
			await svc.incrementUserCounter(sessionUserSafe?.token || '', 1);
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
		const sessionsKV = env.BETA_SESSIONS_KV;
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

		const storageId = sessionUserSafe?.name || sessionUserSafe?.token || '';
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
		if (sessionUser.plan === 'free') {
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
		const trip = {
			...existingTrip, // Preserve original creation date etc.
			...validData, // Apply new edits
			userId: storageId,
			updatedAt: now,
			lastModified: now // <--- Tag this update as user-initiated
		};

		await svc.put(trip as unknown as TripRecord);

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
