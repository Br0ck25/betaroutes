// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, platform }) => {
    // 1. Get the current session ID from the cookie
    const sessionId = cookies.get('session_id');

    // 2. Clear the cookie from the client's browser
    cookies.delete('session_id', { path: '/' });

    // 3. Invalidate the session server-side
    if (sessionId) {
        try {
            // Using BETA_USERS_KV as configured in your login
            const kv = platform?.env?.BETA_USERS_KV;
            if (kv) {
                await kv.delete(sessionId); 
                console.log(`[LOGOUT] Session deleted from KV: ${sessionId}`);
            }
        } catch (error) {
            console.error('[LOGOUT] Failed to delete session from KV:', error);
        }
    }

    // 4. Redirect the user to the login page
    throw redirect(302, '/login');
};