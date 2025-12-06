// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

/**
 * GET /api/trips - List all active trips
 */
export const GET: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const trips = await svc.list(user.token);
    return new Response(JSON.stringify(trips), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('GET /api/trips error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/trips - Create a new trip
 */
export const POST: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const body = await event.request.json();
    const id = (globalThis as any).crypto?.randomUUID?.() ?? String(Date.now());
    const now = new Date().toISOString();

    const trip = {
      id,
      userId: user.token,
      createdAt: now,
      updatedAt: now,
      ...body
    };

    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    await svc.put(trip);
    await svc.incrementUserCounter(user.token, 1);

    return new Response(JSON.stringify(trip), { 
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('POST /api/trips error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
