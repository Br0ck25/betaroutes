// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { findUserById } from '$lib/server/userService';
import { z } from 'zod';
import {
	checkRateLimitEnhanced,
	createRateLimitHeaders,
	getClientIdentifier,
	isAuthenticated,
	RATE_LIMITS
} from '$lib/server/rateLimit';
import {
	validateAndSanitizeRequest,
	createSafeErrorMessage,
	sanitizeQueryParam
} from '$lib/server/sanitize';

const latLngSchema = z.object({
    lat: z.number(),
    lng: z.number()
}).optional();

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
    type: z.string().max(100).optional(),
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

function getEnv(platform: any) {
    const env = platform?.env;
    
    if (platform && (!env?.BETA_LOGS_KV || !env?.TRIP_INDEX_DO)) {
        console.error("CRITICAL: Missing BETA_LOGS_KV or TRIP_INDEX_DO bindings");
        throw new Error('Database bindings missing');
    }

    if (!env?.BETA_LOGS_KV) {
        return {
            kv: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            trashKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            placesKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            usersKV: { get: async () => null },
            tripIndexDO: { idFromName: () => ({ name: 'fake' }), get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: true, count: 0, needsMigration: false })) }) }
        };
    }

    return {
        kv: env.BETA_LOGS_KV,
        trashKV: env.BETA_LOGS_TRASH_KV,
        placesKV: env.BETA_PLACES_KV,
        usersKV: env.BETA_USERS_KV,
        tripIndexDO: env.TRIP_INDEX_DO
    };
}

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		// ← NEW: Rate Limiting
		let env;
		try {
			env = getEnv(event.platform);
		} catch (e) {
			return new Response('Service Unavailable', { status: 503 });
		}

		const sessionsKV = event.platform?.env?.BETA_SESSIONS_KV;
		if (sessionsKV) {
			const identifier = getClientIdentifier(event.request, event.locals);
			const authenticated = isAuthenticated(event.locals);

			// Use different limits for authenticated vs anonymous users
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

		const storageId = user.name || user.token;

		// ← NEW: Sanitize query parameter to prevent injection
		const sinceParam = sanitizeQueryParam(event.url.searchParams.get('since'), 50);
		const sinceDate = sinceParam ? new Date(sinceParam) : null;

		const { kv, trashKV, placesKV, tripIndexDO } = env;
		const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any);

		const allTrips = await svc.list(storageId);

		let tripsToReturn = allTrips;
		if (sinceDate && !isNaN(sinceDate.getTime())) {
			tripsToReturn = allTrips.filter((t) => {
				const recordDate = new Date(t.updatedAt || t.createdAt);
				return recordDate > sinceDate;
			});
		}

		return new Response(JSON.stringify(tripsToReturn), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('GET /api/trips error', err);
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

		// ← NEW: Rate Limiting for trip creation/updates
		const sessionsKV = event.platform?.env?.BETA_SESSIONS_KV;
		if (sessionsKV) {
			const identifier = getClientIdentifier(event.request, event.locals);
			const authenticated = isAuthenticated(event.locals);

			// Use different limits for authenticated vs anonymous users
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

		const storageId = sessionUser.name || sessionUser.token;
		const rawBody = await event.request.json();

		// ← NEW: Sanitize input to prevent XSS and injection attacks
		let sanitizedBody;
		try {
			sanitizedBody = validateAndSanitizeRequest(rawBody, true);
		} catch (sanitizeError) {
			console.error('Sanitization error:', sanitizeError);
			return new Response(
				JSON.stringify({
					error: 'Invalid input data',
					message: 'The submitted data contains invalid or potentially harmful content'
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Validate with Zod schema (now using sanitized data)
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

		let env;
		try {
			env = getEnv(event.platform);
		} catch (e) {
			return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
		}

		const { kv, trashKV, placesKV, usersKV, tripIndexDO } = env;
		const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any);

		const validData = parseResult.data;
		const id = validData.id || crypto.randomUUID();
		let existingTrip = null;

		if (validData.id) {
			existingTrip = await svc.get(storageId, id);
		}

		let currentPlan = sessionUser.plan;
		if (usersKV && usersKV.get) {
			try {
				const freshUser = await findUserById(usersKV as any, sessionUser.id);
				if (freshUser) currentPlan = freshUser.plan;
			} catch (e) {
				console.error('Failed to fetch fresh plan', e);
			}
		}

		if (!existingTrip) {
			const limit = currentPlan === 'free' ? 10 : 999999;
			const quota = await svc.checkMonthlyQuota(storageId, limit);

			if (!quota.allowed) {
				return new Response(
					JSON.stringify({
						error: 'Limit Reached',
						message: `You have reached your free monthly limit of 10 trips. (Used: ${quota.count})`
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		const now = new Date().toISOString();
		const trip = {
			...validData,
			id,
			userId: storageId,
			createdAt: existingTrip ? existingTrip.createdAt : now,
			updatedAt: now
		};

		await svc.put(trip);

		if (!existingTrip) {
			await svc.incrementUserCounter(sessionUser.token, 1);
		}

		return new Response(JSON.stringify(trip), {
			status: 201,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('POST /api/trips error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};