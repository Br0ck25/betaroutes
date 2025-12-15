// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteUser } from '$lib/server/userService';

export const DELETE: RequestHandler = async ({ locals, platform, cookies }) => {
    try {
        const user = locals.user;
        if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

        const env = platform?.env;
        if (!env || !env.BETA_USERS_KV) {
            return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // [!code fix] Inject all bindings for complete cleanup
        await deleteUser(env.BETA_USERS_KV, user.id, {
            tripsKV: env.BETA_LOGS_KV,
            trashKV: env.BETA_LOGS_TRASH_KV,
            settingsKV: env.BETA_USER_SETTINGS_KV,
            tripIndexDO: env.TRIP_INDEX_DO
        });

        // Cleanup Cookies
        cookies.delete('session_id', { path: '/' });
        cookies.delete('token', { path: '/' });

        return json({ success: true });
    } catch (err) {
        console.error('Delete account error:', err);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};