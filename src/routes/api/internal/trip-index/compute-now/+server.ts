import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { ensureDebugEnabled } from '$lib/server/debug';
import { getEnv, safeDO } from '$lib/server/env';

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		ensureDebugEnabled(platform);
	} catch {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body: any = await request.json().catch(() => ({}));
	const { userId, tripId } = body;
	if (!userId || !tripId) {
		return json({ error: 'userId and tripId required' }, { status: 400 });
	}

	const env = getEnv(platform);
	const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO');
	if (!tripIndexDO) return json({ error: 'TRIP_INDEX_DO binding not found' }, { status: 503 });

	try {
		const id = tripIndexDO.idFromName(userId);
		const stub = tripIndexDO.get(id);
		const res = await stub.fetch('http://internal/compute-routes', {
			method: 'POST',
			body: JSON.stringify({ id: tripId })
		});

		const text = await res.text().catch(() => null);
		let parsed: any = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}

		return json(
			{
				ok: res.ok,
				status: res.status,
				body: parsed ?? text
			},
			{ status: 200 }
		);
	} catch (e: any) {
		return json({ error: 'Compute failed', message: e.message }, { status: 500 });
	}
};
