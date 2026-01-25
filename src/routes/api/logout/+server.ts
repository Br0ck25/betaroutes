// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';
import { getEnv, safeKV } from '$lib/server/env';

export const POST: RequestHandler = async ({ cookies, platform }) => {
	const sessionId = cookies.get('session_id');

	// 1. Delete cookie
	cookies.delete('session_id', { path: '/' });

	// 2. Delete session from KV
	if (sessionId) {
		try {
			const env = getEnv(platform);
			const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
			if (sessionsKV) {
				await sessionsKV.delete(sessionId);
				log.info('[LOGOUT] Session deleted', { sessionId });
			}
		} catch (err: unknown) {
			log.error('[LOGOUT] Failed to delete session', {
				message: String((err as Error)?.message ?? err)
			});
		}
	}

	throw redirect(302, '/login');
};
