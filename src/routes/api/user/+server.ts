// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteUser } from '$lib/server/userService';

export const DELETE: RequestHandler = async ({ locals, platform, cookies }) => {
    try {
        const user = locals.user;
        if (!user) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const kv = platform?.env?.BETA_USERS_KV;
        if (!kv) {
            return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // Perform Internal Deletion
        await deleteUser(kv, user.id);

        // Cleanup Cookies
        cookies.delete('session_id', { path: '/' });
        cookies.delete('token', { path: '/' });

        return json({ success: true });

    } catch (err) {
        console.error('Delete account error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};