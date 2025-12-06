// src/routes/api/trash/[id]/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';

/**
 * POST /api/trash/[id]/restore - Restore a trip from trash
 */
export const POST: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { id } = event.params;
    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    const restoredTrip = await svc.restore(user.token, id);
    
    // Increment counter since trip is back
    await svc.incrementUserCounter(user.token, 1);

    return new Response(JSON.stringify(restoredTrip), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('POST /api/trash/[id]/restore error', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    const status = message.includes('not found') ? 404 : 500;
    return new Response(
      JSON.stringify({ error: message }), 
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * DELETE /api/trash/[id] - Permanently delete a trip from trash
 */
export const DELETE: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { id } = event.params;
    const kv = event.platform?.env?.BETA_LOGS_KV;
    const trashKV = event.platform?.env?.BETA_LOGS_TRASH_KV;
    const svc = makeTripService(kv, trashKV);

    await svc.permanentDelete(user.token, id);

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('DELETE /api/trash/[id] error', err);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
