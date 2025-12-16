// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { findUserById } from '$lib/server/userService';
import { z } from 'zod';

// --- Validation Schemas ---
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
    netProfit: z.number().optional(),
    notes: z.string().max(1000).optional(),
    stops: z.array(stopSchema).optional(),
    destinations: z.array(destinationSchema).optional(),
    maintenanceItems: z.array(costItemSchema).optional(),
    suppliesItems: z.array(costItemSchema).optional(),
    lastModified: z.string().optional()
});

// Helper: Fail loudly in production if bindings are missing
function getEnv(platform: any) {
    const env = platform?.env;
    
    // Check for critical bindings if we are in a Cloudflare environment
    if (platform && (!env?.BETA_LOGS_KV || !env?.TRIP_INDEX_DO)) {
        throw new Error('CRITICAL: Database bindings missing in production');
    }

    // Fallback for local 'npm run dev' without wrangler
    if (!env?.BETA_LOGS_KV) {
        return {
            kv: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            trashKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            placesKV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
            usersKV: { get: async () => null },
            tripIndexDO: { idFromName: () => ({ name: 'fake' }), get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: true, count: 0 })) }) }
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

        const sinceParam = event.url.searchParams.get('since');
        const sinceDate = sinceParam ? new Date(sinceParam) : null;

        let env;
        try {
            env = getEnv(event.platform);
        } catch (e) {
            console.error('Environment Error:', e);
            return new Response('Service Unavailable', { status: 503 });
        }

        const { kv, trashKV, placesKV, tripIndexDO } = env;
        
        // Final safety check for production fail-state
        if (!kv.put && event.platform) return new Response('Service Unavailable', { status: 503 });

        const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any);

        // [!code fix] Use Immutable ID (UUID)
        const storageId = user.id;
        
        const allTrips = await svc.list(storageId);

        let tripsToReturn = allTrips;
        if (sinceDate && !isNaN(sinceDate.getTime())) {
            tripsToReturn = allTrips.filter(t => {
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

        const body = await event.request.json();

        // 1. Validate Input
        const parseResult = tripSchema.safeParse(body);
        if (!parseResult.success) {
            return new Response(JSON.stringify({
                error: 'Invalid Data',
                details: parseResult.error.flatten()
            }), { status: 400 });
        }

        let env;
        try {
            env = getEnv(event.platform);
        } catch (e) {
            console.error('Environment Error:', e);
            return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
        }

        const { kv, trashKV, placesKV, usersKV, tripIndexDO } = env;
        if (!kv.put && event.platform) return new Response('Service Unavailable', { status: 503 });

        const svc = makeTripService(kv as any, trashKV as any, placesKV as any, tripIndexDO as any);
        
        // [!code fix] Use Immutable ID (UUID)
        const storageId = sessionUser.id;
        const validData = parseResult.data;

        // 3. Determine ID and Check Existence
        const id = validData.id || crypto.randomUUID();
        let existingTrip = null;

        if (validData.id) {
            existingTrip = await svc.get(storageId, id);
        }

        // [!code fix] 4. Fetch FRESH User Plan (Fix Stale Session Bug)
        let currentPlan = sessionUser.plan;
        
        // If we have the Users KV, fetch the latest status
        if (usersKV && usersKV.get) {
            const freshUser = await findUserById(usersKV as any, sessionUser.id);
            if (freshUser) {
                currentPlan = freshUser.plan;
            }
        }

        // 5. Atomic Billing Check (Using Fresh Plan)
        if (!existingTrip) {
            // Logic:
            // - If FREE: Limit is 10. DO returns { allowed: false } if exceeded.
            // - If PRO: Limit is huge. DO increments stats.
            const limit = currentPlan === 'free' ? 10 : 999999;
            const quota = await svc.checkMonthlyQuota(storageId, limit);
            
            if (!quota.allowed) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: `You have reached your free monthly limit of 10 trips. (Used: ${quota.count})`
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // 6. Prepare Object
        const now = new Date().toISOString();
        const trip = {
            ...validData,
            id,
            userId: storageId,
            createdAt: existingTrip ? existingTrip.createdAt : now,
            updatedAt: now
        };

        // 7. Save
        await svc.put(trip);
        
        // 8. General Lifetime Counter
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