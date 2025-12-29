// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
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
			safeKV(env, 'BETA_LOGS_TRASH_KV'),
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const allTrips = await svc.list(storageId, { since: sinceParam, limit, offset });

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
			safeKV(env, 'BETA_LOGS_TRASH_KV'),
			safeKV(env, 'BETA_PLACES_KV'),
			safeDO(env, 'TRIP_INDEX_DO')!,
			safeDO(env, 'PLACES_INDEX_DO')!
		);

		const validData = parseResult.data;
		const id = validData.id || crypto.randomUUID();
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
			safeKV(env, 'BETA_LOGS_TRASH_KV'),
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
