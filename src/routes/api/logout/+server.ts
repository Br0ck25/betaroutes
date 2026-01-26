// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';
import { getEnv, safeKV } from '$lib/server/env';

export const POST: RequestHandler = async ({ cookies, platform }) => {
	const sessionId = cookies.get('session_id');

	// 1. Delete cookie
	cookies.delete('session_id', { path: '/' });

	// 2. Delete session from KV and remove from active_sessions index
	if (sessionId) {
		try {
			const env = getEnv(platform);
			const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
			if (sessionsKV) {
				// Read session to find associated user id (if present)
				try {
					const sessionStr = await sessionsKV.get(sessionId);
					if (typeof sessionStr === 'string' && sessionStr) {
						const sessionObj = JSON.parse(sessionStr) as Record<string, unknown>;
						const userId = typeof sessionObj['id'] === 'string' ? sessionObj['id'] : undefined;
						if (userId) {
							const activeKey = `active_sessions:${userId}`;
							const activeRaw = await sessionsKV.get(activeKey);
							if (activeRaw) {
								try {
									const sessions = JSON.parse(activeRaw) as string[];
									const filtered = sessions.filter((s) => s !== sessionId);
									await sessionsKV.put(activeKey, JSON.stringify(filtered));
								} catch {
									// best-effort cleanup only
								}
							}
						}
					}
				} catch {
					// best-effort: ignore parse/read errors
				}

				// Finally delete the session record
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
