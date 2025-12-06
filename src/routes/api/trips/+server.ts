// src/routes/api/trips/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

/**
 * Fake KV for local dev so we never crash
 */
function fakeKV() {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [] })
  };
}

/**
 * GET /api/trips - List all active trips
 */
export const GET: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Local dev → fake KV. Cloudflare deploy → real KV.
    const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
    const svc = makeTripService(kv, trashKV);

    const trips = await svc.list(user.token);

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

/**
 * POST /api/trips - Create + sync a new trip
 */
export const POST: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await event.request.json();

    const id =
      (globalThis as any).crypto?.randomUUID?.() ??
      String(Date.now());

    const now = new Date().toISOString();

    // Final trip object stored locally + KV
    const trip = {
      id,
      userId: user.token,
      createdAt: now,
      updatedAt: now,
      ...body
    };

    const kv = event.platform?.env?.BETA_LOGS_KV ?? fakeKV();
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV ?? fakeKV();
    const svc = makeTripService(kv, trashKV);

    // Sync to KV (local mode → no-op, deployed → real)
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
