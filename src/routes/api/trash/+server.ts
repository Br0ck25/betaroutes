// src/routes/api/trash/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

/**
 * GET /api/trash - List all deleted trips in trash
 */
export const GET: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const trashedTrips = await svc.listTrash(user.token);
    
    return new Response(JSON.stringify(trashedTrips), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('GET /api/trash error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * DELETE /api/trash - Empty entire trash (permanently delete all)
 */
export const DELETE: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const count = await svc.emptyTrash(user.token);
    
    return new Response(
      JSON.stringify({ deleted: count, message: `${count} trips permanently deleted` }), 
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('DELETE /api/trash error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
