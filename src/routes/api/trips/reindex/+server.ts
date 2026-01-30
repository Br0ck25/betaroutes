// src/routes/api/trips/reindex/+server.ts
import { safeDO, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { TripRecord } from '$lib/server/tripService';
import { makeTripService } from '$lib/server/tripService';
import type { RequestHandler } from './$types';

// Helper guards to avoid 'any' and to validate KV shape
function hasList(v: unknown): v is {
  list: (
    opts?: Record<string, unknown>
  ) => Promise<{ keys: Array<{ name: string }>; list_complete?: boolean; cursor?: string }>;
} {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['list'] === 'function'
  );
}

function hasGet(v: unknown): v is {
  get: (k: string, type?: 'json' | 'text' | 'arrayBuffer' | 'stream') => Promise<unknown>;
} {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['get'] === 'function'
  );
}

/**
 * POST /api/trips/reindex - Clear DO index and force rebuild from KV
 * This is a maintenance endpoint to fix ghost data issues after migration
 */
export const POST: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const userId = (user as { id?: string }).id || '';

    const kv = safeKV(event.platform?.env, 'BETA_LOGS_KV');
    const placesKV = safeKV(event.platform?.env, 'BETA_PLACES_KV');
    const tripIndexDO = safeDO(event.platform?.env, 'TRIP_INDEX_DO');
    const placesIndexDO = safeDO(event.platform?.env, 'PLACES_INDEX_DO') || tripIndexDO;

    if (!tripIndexDO) {
      return new Response(JSON.stringify({ error: 'DO not available' }), { status: 503 });
    }

    const svc = makeTripService(
      kv as unknown as KVNamespace,
      placesKV as unknown as KVNamespace | undefined,
      tripIndexDO as unknown as DurableObjectNamespace,
      placesIndexDO as unknown as DurableObjectNamespace
    );

    // Clear the DO index by calling the admin wipe endpoint
    const stub = tripIndexDO.get(tripIndexDO.idFromName(userId));
    const doSecret = ((event.platform?.env as Record<string, unknown> | undefined)?.[
      'DO_INTERNAL_SECRET'
    ] ?? '') as string;
    const clearRes = await stub.fetch('https://fake-host/admin/wipe-user', {
      method: 'POST',
      headers: { 'x-do-internal-secret': doSecret }
    });

    if (!clearRes.ok) {
      const errorText = await clearRes.text().catch(() => 'Unable to read error');
      log.error('[Reindex] Failed to clear DO index', { userId, error: errorText });
      return new Response(JSON.stringify({ error: 'Failed to clear index', details: errorText }), {
        status: 500
      });
    }

    log.info('[Reindex] Cleared DO index for user', { userId });

    // Now rebuild the index from KV
    // List all trips from KV with the userId prefix
    const prefix = `trip:${userId}:`;
    let rebuiltCount = 0;
    if (kv && hasList(kv) && hasGet(kv)) {
      const listResult = await kv.list({ prefix });
      for (const key of listResult.keys) {
        const tripData = (await kv.get(key.name, 'json')) as TripRecord | null;
        if (tripData && !(tripData as unknown as Record<string, unknown>)['deleted']) {
          if (typeof (tripData as unknown as Record<string, unknown>)['id'] === 'string') {
            try {
              await svc.put(tripData as TripRecord);
              rebuiltCount++;
            } catch (e) {
              log.warn('[Reindex] Failed to reindex trip', {
                tripId: (tripData as unknown as Record<string, unknown>)['id'],
                error: createSafeErrorMessage(e)
              });
            }
          }
        }
      }
    } else {
      log.warn('[Reindex] KV bindings do not support listing; skipping rebuild');
    }
    log.info('[Reindex] Rebuilt DO index from KV', { userId, tripCount: rebuiltCount });

    return new Response(
      JSON.stringify({
        success: true,
        cleared: true,
        rebuilt: rebuiltCount,
        message: `Index cleared and rebuilt with ${rebuiltCount} trips`
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    log.error('POST /api/trips/reindex error', { message: createSafeErrorMessage(err) });
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
