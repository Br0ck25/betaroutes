// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
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

function fakeKV() {
    return {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] })
    };
}

function fakeDO() {
    return {
        idFromName: () => ({ name: 'fake' }),
        get: () => ({
            fetch: async () => new Response(JSON.stringify({ allowed: true, count: 0 }))
        })
    };
}

export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const sinceParam = event.url.searchParams.get('since');
        const sinceDate = sinceParam ? new Date(sinceParam) : null;

        const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
        const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
        const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV();
        const tripIndexDO = event.platform?.env?.TRIP_INDEX_DO ?? fakeDO();

        const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO);

        const storageId = user.name || user.token;
        
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
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const body = await event.request.json();

        // 1. Validate Input
        const parseResult = tripSchema.safeParse(body);
        if (!parseResult.success) {
            return new Response(
                JSON.stringify({
                    error: 'Invalid Data',
                    details: parseResult.error.flatten()
                }),
                { status: 400 }
            );
        }

        // 2. Initialize Service
        const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
        const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
        const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV();
        const tripIndexDO = event.platform?.env?.TRIP_INDEX_DO ?? fakeDO();

        const svc = makeTripService(kv, trashKV, placesKV, tripIndexDO);
        const storageId = user.name || user.token;
        const validData = parseResult.data;

        // 3. Determine ID and Check Existence
        const id = validData.id || crypto.randomUUID();
        let existingTrip = null;

        if (validData.id) {
            existingTrip = await svc.get(storageId, id);
        }

        // [!code fix] 4. Atomic Billing Check (Durable Object)
        if (!existingTrip) {
            // Logic:
            // - If FREE: Limit is 10. DO returns { allowed: false } if exceeded.
            // - If PRO: Limit is huge (e.g. 1M). DO just increments stats.
            const limit = user.plan === 'free' ? 10 : 999999;
            const quota = await svc.checkMonthlyQuota(storageId, limit);
            
            if (!quota.allowed) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: `You have reached your free monthly limit of 10 trips. (Used: ${quota.count})`
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // 5. Prepare Object
        const now = new Date().toISOString();
        const trip = {
            ...validData,
            id,
            userId: storageId,
            createdAt: existingTrip ? existingTrip.createdAt : now,
            updatedAt: now
        };

        // 6. Save
        await svc.put(trip);
        
        // 7. General Lifetime Counter (Legacy support)
        if (!existingTrip) {
            await svc.incrementUserCounter(user.token, 1);
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