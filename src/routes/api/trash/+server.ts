// src/routes/api/trash/+server.ts
import { dev } from '$app/environment';
import { safeDO, safeKV } from '$lib/server/env';
import { makeExpenseService } from '$lib/server/expenseService';
import { log } from '$lib/server/log';
import { makeMileageService } from '$lib/server/mileageService';
import { makeTripService } from '$lib/server/tripService';
import { getStorageId } from '$lib/server/user';
import type { RequestHandler } from './$types';

// [!code fix] SECURITY: Removed fakeKV and fakeDO fallbacks that caused silent data loss in production.
// Dev mode gracefully handles missing bindings; production fails safely.

export const GET: RequestHandler = async (event) => {
  try {
    const user = event.locals.user;
    if (!user) return new Response('Unauthorized', { status: 401 });

    const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
    const kv = safeKV(platformEnv, 'BETA_LOGS_KV');
    const placesKV = safeKV(platformEnv, 'BETA_PLACES_KV');

    // [!code fix] SECURITY: Fail properly in production if KV bindings are missing
    if (!kv && !dev) {
      log.error('[API/trash] BETA_LOGS_KV binding missing in production');
      return new Response('Service Unavailable', { status: 503 });
    }

    // Durable Object bindings
    const tripIndexDO = safeDO(platformEnv, 'TRIP_INDEX_DO');
    if (!tripIndexDO && !dev) {
      log.error('[API/trash] TRIP_INDEX_DO binding missing in production');
      return new Response('Service Unavailable', { status: 503 });
    }
    const placesIndexDO = safeDO(platformEnv, 'PLACES_INDEX_DO') ?? tripIndexDO;

    // Initialize Services
    const tripSvc = makeTripService(
      kv as KVNamespace,
      placesKV as KVNamespace | undefined,
      tripIndexDO as DurableObjectNamespace,
      placesIndexDO as DurableObjectNamespace
    );

    const expenseSvc = makeExpenseService(
      safeKV(platformEnv, 'BETA_EXPENSES_KV') as KVNamespace,
      tripIndexDO as DurableObjectNamespace
    );

    const mileageSvc = makeMileageService(
      safeKV(platformEnv, 'BETA_MILEAGE_KV') as KVNamespace,
      tripIndexDO as DurableObjectNamespace,
      safeKV(platformEnv, 'BETA_LOGS_KV') as KVNamespace | undefined
    );

    const currentUser = user as { id?: string; name?: string; token?: string };
    const storageId = getStorageId(currentUser);

    if (!storageId) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let cloudTrash: unknown[] = [];
    try {
      const type = (event.url.searchParams.get('type') || '').toLowerCase();

      // Fetch based on filter or fetch all
      if (type === 'expenses') {
        cloudTrash = await expenseSvc.listTrash(storageId);
      } else if (type === 'mileage') {
        cloudTrash = await mileageSvc.listTrash(storageId);
      } else if (type === 'trips') {
        cloudTrash = await tripSvc.listTrash(storageId);
      } else {
        // Fetch ALL and merge
        const [trips, expenses, mileage] = await Promise.all([
          tripSvc.listTrash(storageId),
          expenseSvc.listTrash(storageId),
          mileageSvc.listTrash(storageId)
        ]);

        cloudTrash = [...trips, ...expenses, ...mileage].sort(
          (a: { metadata?: { deletedAt?: string } }, b: { metadata?: { deletedAt?: string } }) =>
            (b.metadata?.deletedAt || '').localeCompare(a.metadata?.deletedAt || '')
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Failed to list cloud trash', { message });
    }

    return new Response(JSON.stringify(cloudTrash), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('GET /api/trash error', { message });
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500
    });
  }
};

export const DELETE: RequestHandler = async () => {
  // Bulk delete implementation usually done one-by-one by client,
  // or implemented here if needed. Keeping placeholder for now.
  return new Response(JSON.stringify({ deleted: 0 }), { status: 200 });
};
