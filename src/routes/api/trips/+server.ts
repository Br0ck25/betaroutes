// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { z } from 'zod';

function fakeKV() {
	return {
		get: async () => null,
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [] })
	};
}

// [!code ++] Location Schema
const latLngSchema = z.object({
    lat: z.number(),
    lng: z.number()
}).optional();

// Updated sub-schemas
const destinationSchema = z.object({
    address: z.string().max(500).optional().default(''),
    earnings: z.number().optional().default(0),
    location: latLngSchema // [!code ++]
});

const stopSchema = z.object({
    id: z.string().optional(),
    address: z.string().max(500).optional(),
    earnings: z.number().optional(),
    notes: z.string().max(1000).optional(),
    order: z.number().optional(),
    location: latLngSchema // [!code ++]
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
    startLocation: latLngSchema, // [!code ++]
	endAddress: z.string().max(500).optional(),
    endLocation: latLngSchema,   // [!code ++]
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

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const body = await event.request.json();

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

		const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV();

		const svc = makeTripService(kv, trashKV, placesKV);
        const storageId = user.name || user.token;

        if (user.plan === 'free') {
            const monthlyCount = await svc.getMonthlyTripCount(storageId);

            if (monthlyCount >= 10) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: 'You have reached your free monthly limit of 10 trips.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

		const validData = parseResult.data;
		const id = validData.id || crypto.randomUUID();
		const now = new Date().toISOString();

		const trip = {
			...validData,
			id,
			userId: storageId,
			createdAt: now,
			updatedAt: now
		};

		await svc.put(trip);
        
        await svc.incrementMonthlyTripCount(storageId);
		await svc.incrementUserCounter(user.token, 1);

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