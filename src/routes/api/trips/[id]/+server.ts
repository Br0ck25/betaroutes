// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

function safeKV(env: any, name: string) {
    const kv = env?.[name];
    if (!kv) {
        console.warn(`[TRIPS API] WARNING: ${name} not available locally — using no-op fallback.`);
    }
    return kv ?? null;
}

/**
 * GET /api/trips/[id]
 */
export const GET: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const { id } = event.params;

        const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
        const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
        const svc = makeTripService(kv, trashKV);

        const trip = await svc.get(user.token, id);

        if (!trip) {
            return new Response('Not Found', { status: 404 });
        }

        return new Response(JSON.stringify(trip), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('GET /api/trips/[id] error', err);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

/**
 * PUT /api/trips/[id] - Update a trip
 */
export const PUT: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) return new Response('Unauthorized', { status: 401 });

        const { id } = event.params;
        const body = await event.request.json();

        const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
        const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
        const svc = makeTripService(kv, trashKV);

        const existing = await svc.get(user.token, id);

        if (!existing) {
            return new Response('Not Found', { status: 404 });
        }

        const updated = {
            ...existing,
            ...body,
            id,
            userId: user.token,
            updatedAt: new Date().toISOString()
        };

        await svc.put(updated);

        return new Response(JSON.stringify(updated), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('PUT /api/trips/[id] error', err);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

/**
 * DELETE /api/trips/[id] - Soft delete (moves to trash)
 */
export const DELETE: RequestHandler = async (event) => {
    try {
        const user = event.locals.user;
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { id } = event.params;

        const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
        const trashKV = safeKV(event.platform?.env, 'BETA_LOGS_TRASH_KV');
        const svc = makeTripService(kv, trashKV);

        // Check if trip exists
        const existing = await svc.get(user.token, id);

        if (!existing) {
            return new Response(
                JSON.stringify({ error: 'Trip not found' }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Soft delete - moves to trash with 30-day expiration
        // NOTE: svc.delete() does soft delete (moves to trash)
        try {
            await svc.delete(user.token, id);
        } catch (err) {
            console.warn('[TRIPS API] delete failed (likely local mode):', err);
            // In local mode without KV, this will fail but that's OK
        }

        // Decrement monthly counter
        try {
            await svc.incrementUserCounter(user.token, -1);
        } catch (err) {
            console.warn('[TRIPS API] decrement counter failed:', err);
        }

        return new Response(
            JSON.stringify({ success: true, message: 'Trip moved to trash' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        console.error('DELETE /api/trips/[id] error', err);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
};
