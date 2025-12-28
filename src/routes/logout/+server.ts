// src/routes/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, platform }) => {
    const sessionId = cookies.get('session_id');

    // 1. Delete cookie
    cookies.delete('session_id', { path: '/' });

    // 2. Delete session from SESSIONS_KV
    if (sessionId) {
        try {
            const { getEnv, safeKV } = await import('$lib/server/env');
            const env = getEnv(platform);
            const sessionKV = safeKV(env, 'BETA_SESSIONS_KV');
            if (sessionKV) {
                await sessionKV.delete(sessionId); 
            }
        } catch (error) {
            console.error('[LOGOUT] Failed to delete session:', error);
        }
    }

    throw redirect(302, '/login');
};