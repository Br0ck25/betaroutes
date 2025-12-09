// src/routes/api/logout/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, platform }) => {
    // 1. Get the current session token from the cookie
    const token = cookies.get('token');

    // 2. Clear the cookie from the client's browser
    // CRITICAL: We do this directly here instead of importing from the missing session.ts
    cookies.delete('token', { path: '/' });

    // 3. Invalidate the token server-side (delete KV record)
    if (token) {
        try {
            const usersKV = platform?.env?.BETA_USERS_KV;
            if (usersKV) {
                await usersKV.delete(token); 
                console.log(`[LOGOUT] Session token deleted from KV: ${token}`);
            }
        } catch (error) {
            console.error('[LOGOUT] Failed to delete token from KV:', error);
        }
    }

    // 4. Redirect the user to the login page
    throw redirect(302, '/login');
};