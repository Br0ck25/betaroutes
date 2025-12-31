import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeDO } from '$lib/server/env';
import { ensureDebugEnabled } from '$lib/server/debug';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		ensureDebugEnabled(platform);
	} catch {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body: any = await request.json().catch(() => ({}));
	const { userId, id: tripId } = body;
	if (!userId || !tripId) {
		return json({ error: 'Missing userId or trip id in body' }, { status: 400 });
	}

	const env = getEnv(platform);
	const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO');
	if (!tripIndexDO) return json({ error: 'TRIP_INDEX_DO not bound' }, { status: 500 });

	try {
		const doId = tripIndexDO.idFromName(userId);
		const stub = tripIndexDO.get(doId);
		const res = await stub.fetch('http://internal/compute-routes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: tripId })
		});

		const text = await res.text().catch(() => '[no-body]');
		log.info(`[Debug] Forced compute for ${userId}:${tripId} => ${res.status}`);
		return json({ status: res.status, body: text });
	} catch (e: any) {
		log.warn('[Debug] Failed to force compute', { message: e.message });
		return json({ error: 'Failed to invoke DO', message: e.message }, { status: 500 });
	}
};
