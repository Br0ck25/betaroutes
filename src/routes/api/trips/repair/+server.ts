/**
 * Temporary Fix: Mark Trip Index as Dirty
 *
 * This file creates an API endpoint to manually mark a user's trip index as "dirty",
 * forcing the next list() call to read from KV (source of truth) and repair the DO index.
 *
 * USE CASE: HughesNet-synced trips exist in KV but aren't showing in UI
 * CAUSE: Durable Object write failed during sync, index out of sync with KV
 * FIX: Mark index dirty → next UI load reads from KV and repairs DO
 *
 * TO USE:
 * 1. Deploy this endpoint
 * 2. Call: POST /api/trips/repair with empty body
 * 3. Refresh dashboard - trips will appear
 * 4. Delete this file after all users are repaired
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ locals, platform }) => {
	try {
		const user = locals.user as { id?: string; token?: string } | undefined;
		if (!user || !user.id) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const env = getEnv(platform);
		const kv = safeKV(env, 'BETA_LOGS_KV');

		if (!kv) {
			return json({ error: 'KV not available' }, { status: 500 });
		}

		const userId = user.id;
		const dirtyKey = `meta:user:${userId}:index_dirty`;

		// Mark the index as dirty
		await kv.put(dirtyKey, '1');

		log.info('[TripRepair] Marked trip index as dirty', { userId });

		return json({
			success: true,
			message:
				'Trip index marked as dirty. Refresh the dashboard to trigger repair and see all trips.'
		});
	} catch (error) {
		log.error('[TripRepair] Error marking index dirty', { error });
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
