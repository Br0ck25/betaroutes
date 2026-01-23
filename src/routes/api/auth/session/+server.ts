import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const user = locals.user;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
		return json({ success: true, user });
	} catch (e) {
		log.error('[Auth Session] Error', { message: (e as any)?.message });
		return json({ error: 'Failed to check session' }, { status: 500 });
	}
};
