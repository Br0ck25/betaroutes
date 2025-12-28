// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, platform }) => {
    const sessionId = cookies.get('session_id');

    // 1. Delete cookie
    cookies.delete('session_id', { path: '/' });

    // 2. Delete session from KV
    if (sessionId) {
        try {
            // [!code fix] Delete from SESSIONS_KV
            const sessionKV = (platform?.env as any)?.BETA_SESSIONS_KV;
            if (sessionKV) {
                await sessionKV.delete(sessionId); 
                console.log(`[LOGOUT] Session deleted: ${sessionId}`);
            }
        } catch (error) {
            console.error('[LOGOUT] Failed to delete session:', error);
        }
    }

    throw redirect(302, '/login');
};