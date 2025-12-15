// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { z } from 'zod';
import { dev } from '$app/environment';

// --- Validation Schemas ---

// Helper: Factory function to create custom-length safe strings
const createSafeString = (maxLength: number = 500) => z.string()
    .trim()
    .max(maxLength)
    .refine(s => !/^[=+\-@]/.test(s), { message: "Input contains unsafe characters." });

const idSchema = z.string().uuid();

const latLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
}).optional();

// Consolidated Destination/Stop Schema
const destinationSchema = z.object({
    id: z.string().optional(),
    address: createSafeString(500).optional().default(''),
    earnings: z.number().min(0).optional().default(0),
    notes: createSafeString(1000).optional(),
    order: z.number().int().optional(),
    location: latLngSchema,
    completed: z.boolean().optional().default(true) 
});

const costItemSchema = z.object({
    type: createSafeString(100).optional(),
    cost: z.number().min(0).optional()
});

const tripSchema = z.object({
    id: idSchema,
    // [!code fix] Relax date validation to accept "YYYY-MM-DD" from client
    date: z.string().optional(), 
    startTime: z.string().max(20).optional(),
    endTime: z.string().max(20).optional(),
    
    startAddress: createSafeString(500).optional(),
    endAddress: createSafeString(500).optional(),
    
    startLocation: latLngSchema,
    endLocation: latLngSchema,
    
    totalMiles: z.number().nonnegative().optional().default(0),
    estimatedTime: z.number().optional().default(0), 
    mpg: z.number().positive().optional(),
    gasPrice: z.number().nonnegative().optional(),
    
    maintenanceItems: z.array(costItemSchema).max(20).optional(),
    suppliesItems: z.array(costItemSchema).max(20).optional(),
    
    // Allow both 'stops' (legacy/UI) and 'destinations' (logic)
    stops: z.array(destinationSchema).max(50).optional(),
    destinations: z.array(destinationSchema).max(50).optional(),
    
    notes: createSafeString(2000).optional(),
    
    // Allow lastModified to pass through (server overrides updatedAt anyway)
    lastModified: z.string().optional(),
    clientUpdatedAt: z.string().optional()
});

// Helper: Throw in production, warn in dev
function getKV(platform: App.Platform | undefined, name: keyof App.Platform['env']) {
    const kv = platform?.env?.[name];
    if (!kv) {
        if (!dev) throw new Error(`CRITICAL: Database ${name} missing in production.`);
        console.warn(`[Mock] Using in-memory store for ${name} (Dev Mode)`);
        return {
            get: async () => null,
            put: async () => {},
            delete: async () => {},
            list: async () => ({ keys: [] })
        } as any;
    }
    return kv;
}

// --- GET Handler ---
export const GET: RequestHandler = async ({ locals, url, platform }) => {
    try {
        const user = locals.user;
        if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

        const headers = {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };

        const sinceParam = url.searchParams.get('since');
        const sinceDate = sinceParam ? new Date(sinceParam) : null;

        const kv = getKV(platform, 'BETA_LOGS_KV');
        const trashKV = getKV(platform, 'BETA_LOGS_TRASH_KV');
        const placesKV = getKV(platform, 'BETA_PLACES_KV');
        
        const svc = makeTripService(kv, trashKV, placesKV);

        const allTrips = await svc.list(user.id);

        let tripsToReturn = allTrips;
        if (sinceDate && !isNaN(sinceDate.getTime())) {
            tripsToReturn = allTrips.filter(t => {
                const recordDate = new Date(t.updatedAt || t.createdAt);
                return recordDate > sinceDate;
            });
        }

        return new Response(JSON.stringify(tripsToReturn), { status: 200, headers });

    } catch (err: any) {
        console.error('[API] GET /trips error:', err.message);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
};

// --- POST Handler ---
export const POST: RequestHandler = async ({ request, locals, platform }) => {
    try {
        const user = locals.user;
        if (!user || !user.id) return new Response('Unauthorized', { status: 401 });

        const body = await request.json();

        // 1. Validate Input
        const parseResult = tripSchema.safeParse(body);
        if (!parseResult.success) {
            console.error('[API] Validation Error:', JSON.stringify(parseResult.error.flatten()));
            return new Response(JSON.stringify({
                error: 'Invalid Data',
                details: parseResult.error.flatten()
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const data = parseResult.data;
        const tripId = data.id;

        // 2. Initialize Service
        const kv = getKV(platform, 'BETA_LOGS_KV');
        const trashKV = getKV(platform, 'BETA_LOGS_TRASH_KV');
        const placesKV = getKV(platform, 'BETA_PLACES_KV');
        const svc = makeTripService(kv, trashKV, placesKV);

        // 3. Check Idempotency
        const existingTrip = await svc.get(user.id, tripId);

        // 4. Check Limits (New Trips Only)
        if (!existingTrip && user.plan === 'free') {
            const monthlyCount = await svc.getMonthlyTripCount(user.id);
            if (monthlyCount >= 10) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: 'Free plan limit (10 trips) reached. Please upgrade.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        // 5. Server-Side Calculations
        const miles = data.totalMiles || 0;
        const mpg = data.mpg || 25;
        const gas = data.gasPrice || 3.50;
        const fuelCost = mpg > 0 ? (miles / mpg) * gas : 0;

        const maintenanceCost = (data.maintenanceItems || []).reduce((sum, i) => sum + (i.cost || 0), 0);
        const suppliesCost = (data.suppliesItems || []).reduce((sum, i) => sum + (i.cost || 0), 0);

        // Sum earnings from destinations OR stops
        const itemsToSum = (data.destinations && data.destinations.length > 0) ? data.destinations : (data.stops || []);
        const totalEarnings = itemsToSum.reduce((sum, d) => sum + (d.earnings || 0), 0);

        const netProfit = totalEarnings - (fuelCost + maintenanceCost + suppliesCost);

        const now = new Date().toISOString();
        
        const tripToSave = {
            ...data,
            id: tripId,
            userId: user.id,
            
            fuelCost: Number(fuelCost.toFixed(2)),
            maintenanceCost: Number(maintenanceCost.toFixed(2)),
            suppliesCost: Number(suppliesCost.toFixed(2)),
            totalEarnings: Number(totalEarnings.toFixed(2)),
            netProfit: Number(netProfit.toFixed(2)),

            createdAt: existingTrip ? existingTrip.createdAt : now,
            updatedAt: now
        };

        await svc.put(tripToSave);

        if (!existingTrip) {
            await svc.incrementMonthlyTripCount(user.id);
            console.log(`[Billing] New trip created: ${tripId}`);
        } else {
            console.log(`[Sync] Trip updated: ${tripId}`);
        }

        return new Response(JSON.stringify(tripToSave), {
            status: existingTrip ? 200 : 201,
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store' 
            }
        });

    } catch (err: any) {
        console.error('[API] POST /trips error:', err.message);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
};