// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function safeKV(env: any, name: string) {
	const kv = env?.[name];
	return kv ?? null;
}

export const POST: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const svc = makeTripService(kv, trashKV);

		// FIX: Use stable User ID (name)
		const storageId = user.name || user.token;

        // --- ENFORCE LIMIT ---
        if (user.plan === 'free') {
            if (trashKV) {
                // Get trash item to check its date
                const trashKey = `trash:${storageId}:${id}`;
                const raw = await trashKV.get(trashKey);
                
                if (raw) {
                    const parsed = JSON.parse(raw);
                    const trip = parsed.trip;

                    if (trip && trip.date) {
                        const tripDate = new Date(trip.date);
                        const tYear = tripDate.getFullYear();
                        const tMonth = tripDate.getMonth();

                        // Count active trips for that specific month
                        const allTrips = await svc.list(storageId);
                        const count = allTrips.filter(t => {
                            if (!t.date) return false;
                            const [y, m] = t.date.split('-').map(Number);
                            // t.date is YYYY-MM-DD (1-indexed month), JS is 0-indexed
                            return y === tYear && (m - 1) === tMonth;
                        }).length;

                        if (count >= 10) {
                             return new Response(JSON.stringify({ 
                                error: 'Free tier limit reached (10 trips/month). Please upgrade to Pro.' 
                            }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                        }
                    }
                }
            }
        }
        // ---------------------

		const restoredTrip = await svc.restore(storageId, id);

		await svc.incrementUserCounter(user.token, 1);

		return new Response(JSON.stringify(restoredTrip), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		console.error('POST /api/trash/[id]/restore error', err);
		const message = err instanceof Error ? err.message : 'Internal Server Error';
		const status = message.includes('not found') ? 404 : 500;
		return new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const user = event.locals.user;
		if (!user) return new Response('Unauthorized', { status: 401 });

		const { id } = event.params;
		const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
		const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
		const svc = makeTripService(kv, trashKV);

		// FIX: Use stable User ID (name)
		const storageId = user.name || user.token;
		await svc.permanentDelete(storageId, id);

		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('DELETE /api/trash/[id] error', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};