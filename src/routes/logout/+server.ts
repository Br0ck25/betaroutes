// src/routes/logout/+server.ts
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

	// 2. Delete session from SESSIONS_KV
	if (sessionId) {
		try {
			const { getEnv, safeKV } = await import('$lib/server/env');
			const env = getEnv(platform);
			const sessionKV = safeKV(env, 'BETA_SESSIONS_KV');
			if (sessionKV) {
				await sessionKV.delete(sessionId);
			}
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			log.error('[LOGOUT] Failed to delete session', { message: msg });
		}
	}

	throw redirect(302, '/login');
};
