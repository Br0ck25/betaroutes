// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { z } from 'zod';

// --- Validation Schemas (Restored) ---

// Location Schema
const latLngSchema = z.object({
    lat: z.number(),
    lng: z.number()
}).optional();

// Updated sub-schemas
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

// Helper for dev mode (Restored)
function fakeKV() {
    return {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        list: async () => ({ keys: [] })
    };
}

// --- GET Handler (Restored for Sync) ---
export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const sinceParam = event.url.searchParams.get('since');
        const sinceDate = sinceParam ? new Date(sinceParam) : null;

        const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
        const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
        const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV();
        
        const svc = makeTripService(kv, trashKV, placesKV);

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

// --- POST Handler (Fixed with Idempotency) ---
export const POST: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const body = await event.request.json();

        // 1. Validate Input (Zod)
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

        const svc = makeTripService(kv, trashKV, placesKV);
        const storageId = user.name || user.token;
        const validData = parseResult.data;

        // 3. Determine ID and Check Existence
        // If client sends an ID (SyncManager), we check if it exists.
        // If client sends no ID (New Trip UI), we generate one (definitely new).
        const id = validData.id || crypto.randomUUID();
        let existingTrip = null;

        if (validData.id) {
            existingTrip = await svc.get(storageId, id);
        }

        // 4. Check Limits (ONLY if this is a BRAND NEW trip)
        // We do not want to block users from *updating* existing trips even if they are over limit.
        if (!existingTrip && user.plan === 'free') {
            const monthlyCount = await svc.getMonthlyTripCount(storageId);
            if (monthlyCount >= 10) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: 'You have reached your free monthly limit of 10 trips.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // 5. Prepare Object
        const now = new Date().toISOString();
        const trip = {
            ...validData,
            id,
            userId: storageId,
            // Preserve original creation date if updating, otherwise use now
            createdAt: existingTrip ? existingTrip.createdAt : now,
            updatedAt: now
        };

        // 6. Save (Idempotent)
        await svc.put(trip);
        
        // 7. Billing / Counters (ONLY if BRAND NEW)
        if (!existingTrip) {
            await svc.incrementMonthlyTripCount(storageId);
            await svc.incrementUserCounter(user.token, 1);
            console.log(`[Billing] Counted new trip ${id} for user ${user.token}`);
        } else {
            console.log(`[Billing] Updated existing trip ${id} - No charge`);
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