// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ cookies, platform }) => {
	const sessionId = cookies.get('session_id');

	// 1. Delete all auth-related cookies (both current and legacy names)
	cookies.delete('session_id', { path: '/' });
	cookies.delete('token', { path: '/' }); // Legacy cookie
	cookies.delete('csrf_token', { path: '/' });
	cookies.delete('csrf_token_readable', { path: '/' });
	cookies.delete('webauthn-challenge', { path: '/' });

	// 2. Delete session from KV
	if (sessionId) {
		try {
			// [!code fix] Delete from SESSIONS_KV
			const sessionKV = (platform?.env as any)?.BETA_SESSIONS_KV;
			if (sessionKV) {
				await sessionKV.delete(sessionId);
				log.info('[LOGOUT] Session deleted', { sessionId });
			}
		} catch (error) {
			log.error('[LOGOUT] Failed to delete session', { message: (error as any)?.message });
		}
	}

	throw redirect(302, '/login');
};
