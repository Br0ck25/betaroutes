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

const tripSchema = z.object({
	id: z.string().uuid().optional(),
	date: z.string().optional(),
	startTime: z.string().optional(),
	endTime: z.string().optional(),
	hoursWorked: z.number().optional(),
	startAddress: z.string().max(500).optional(),
	endAddress: z.string().max(500).optional(),
	totalMiles: z.number().nonnegative().optional(),
	
    // --- FIX: Added missing time fields ---
    estimatedTime: z.number().optional(), // Drive time in minutes
    totalTime: z.string().optional(),     // Drive time as string "1h 30m"
    // -------------------------------------

	mpg: z.number().positive().optional(),
	gasPrice: z.number().nonnegative().optional(),
	fuelCost: z.number().optional(),
	maintenanceCost: z.number().optional(),
	suppliesCost: z.number().optional(),
	netProfit: z.number().optional(),
	notes: z.string().max(1000).optional(),
	stops: z.array(z.any()).optional(),
	destinations: z.array(z.any()).optional(),
	maintenanceItems: z.array(z.any()).optional(),
	suppliesItems: z.array(z.any()).optional(),
	lastModified: z.string().optional()
});

export const GET: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV(); // [!code ++]
		
		const svc = makeTripService(kv, trashKV, placesKV); // [!code ++]

		const storageId = user.name || user.token;
		const trips = await svc.list(storageId);

		return new Response(JSON.stringify(trips), {
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
		const placesKV = event.platform?.env?.BETA_PLACES_KV ?? fakeKV(); // [!code ++]

		const svc = makeTripService(kv, trashKV, placesKV); // [!code ++]
        const storageId = user.name || user.token;

        // --- ENFORCE MONTHLY LIMIT ---
        if (user.plan === 'free') {
            const allTrips = await svc.list(storageId);
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth(); // 0-indexed

            const monthlyCount = allTrips.filter(t => {
                if (!t.date) return false;
                const [y, m] = t.date.split('-').map(Number);
                return y === currentYear && (m - 1) === currentMonth;
            }).length;

            if (monthlyCount >= 10) {
                return new Response(JSON.stringify({
                    error: 'Limit Reached',
                    message: 'You have reached your free monthly limit of 10 trips.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }
        // -----------------------------

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