// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteUser } from '$lib/server/userService';

export const DELETE: RequestHandler = async ({ locals, platform, cookies }) => {
	try {
        // 1. Validate Auth via Locals (Secure)
        const user = locals.user;
        if (!user) {
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const kv = platform?.env?.BETA_USERS_KV;
        if (!kv) {
            return json({ error: 'Service Unavailable' }, { status: 503 });
        }

        // 2. Internal Deletion (No external proxy)
		await deleteUser(kv, user.id);

        // 3. Clear Cookies
		cookies.delete('token', { path: '/' });
        cookies.delete('session_id', { path: '/' });

		return json({ success: true }, { status: 200 });

	} catch (err) {
		console.error('Delete account error:', err);
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};