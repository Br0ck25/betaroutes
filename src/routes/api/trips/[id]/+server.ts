// src/routes/api/trips/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

/**
 * GET /api/trips/[id] - Get a single trip
 */
export const GET: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { id } = event.params;
    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const trip = await svc.get(user.token, id);
    if (!trip) return new Response('Not Found', { status: 404 });
    
    return new Response(JSON.stringify(trip), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('GET /api/trips/[id] error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
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

    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const existing = await svc.get(user.token, id);
    if (!existing) return new Response('Not Found', { status: 404 });

    const updated = {
      ...existing,
      ...body,
      id,  // Ensure ID doesn't change
      userId: user.token,  // Ensure userId doesn't change
      updatedAt: new Date().toISOString()
    };

    await svc.put(updated);
    
    return new Response(JSON.stringify(updated), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('PUT /api/trips/[id] error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * DELETE /api/trips/[id] - Soft delete (move to trash)
 */
export const DELETE: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { id } = event.params;
    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    // Soft delete - moves to trash for 30 days
    await svc.delete(user.token, id);
    
    // Decrement counter (best effort)
    await svc.incrementUserCounter(user.token, -1);

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('DELETE /api/trips/[id] error', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return new Response(
      JSON.stringify({ error: message }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
