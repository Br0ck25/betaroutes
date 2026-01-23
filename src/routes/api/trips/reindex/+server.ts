// src/routes/api/trips/reindex/+server.ts
import type { RequestHandler } from './$types';
import { makeTripService } from '$lib/server/tripService';
import { safeKV, safeDO } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

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
			undefined,
			placesKV as unknown as KVNamespace | undefined,
			tripIndexDO as unknown as DurableObjectNamespace,
			placesIndexDO as unknown as DurableObjectNamespace
		);

		// Clear the DO index by calling the admin wipe endpoint
		const stub = tripIndexDO.get(tripIndexDO.idFromName(userId));
		const clearRes = await stub.fetch('https://fake-host/admin/wipe-user', { method: 'POST' });

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
		const listResult = await (kv as any).list({ prefix });

		let rebuiltCount = 0;
		for (const key of listResult.keys) {
			const tripData = await (kv as any).get(key.name, { type: 'json' });
			if (tripData && !tripData.deleted) {
				try {
					await svc.put(tripData);
					rebuiltCount++;
				} catch (e) {
					log.warn('[Reindex] Failed to reindex trip', {
						tripId: tripData.id,
						error: createSafeErrorMessage(e)
					});
				}
			}
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
