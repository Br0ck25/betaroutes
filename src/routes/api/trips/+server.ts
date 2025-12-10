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
    estimatedTime: z.number().optional(),
    totalTime: z.string().optional(),
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
		const svc = makeTripService(kv, trashKV);

		const storageIds = new Set<string>();
        if (user.id) storageIds.add(user.id);
        if (user.name) storageIds.add(user.name);
        if (user.token) storageIds.add(user.token);

        let allTrips: any[] = [];
        for (const storageId of storageIds) {
            const trips = await svc.list(storageId);
            allTrips = allTrips.concat(trips);
        }

        const uniqueTrips = Array.from(new Map(allTrips.map(item => [item.id, item])).values());

		return new Response(JSON.stringify(uniqueTrips), {
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
				JSON.stringify({ error: 'Invalid Data', details: parseResult.error.flatten() }),
				{ status: 400 }
			);
		}

		const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
		const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
		const svc = makeTripService(kv, trashKV);
        
        const storageId = user.id || user.name || user.token;

        if (user.plan === 'free') {
            const allTrips = await svc.list(storageId);
            const now = new Date();
            const monthlyCount = allTrips.filter(t => {
                if (!t.date) return false;
                const [y, m] = t.date.split('-').map(Number);
                return y === now.getFullYear() && (m - 1) === now.getMonth();
            }).length;

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
		await svc.incrementUserCounter(user.token, 1);

		return new Response(JSON.stringify(trip), { status: 201 });
	} catch (err) {
		console.error('POST /api/trips error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

// --- SOFT DELETE ALL ---
export const DELETE: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
        const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
        const svc = makeTripService(kv, trashKV);

        // Find ALL trips from ALL IDs
        const storageIds = new Set<string>();
        if (user.id) storageIds.add(user.id);
        if (user.name) storageIds.add(user.name);
        if (user.token) storageIds.add(user.token);

        let count = 0;
        
        // Loop through all identities
        for (const storageId of storageIds) {
            const trips = await svc.list(storageId);
            
            // Loop through all trips found for that identity
            for (const trip of trips) {
                try {
                    // Soft Delete: Move to Trash
                    // We use the trip's actual userId property to ensure we target the right key
                    await svc.delete(trip.userId || storageId, trip.id);
                    count++;
                } catch (e) {
                    console.log(`Skipping ${trip.id} (already deleted or not found)`);
                }
            }
        }

        return new Response(JSON.stringify({ success: true, count }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('DELETE /api/trips error', err);
        return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
    }
};