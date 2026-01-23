// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
// [!code change] Import updateUser
import { deleteUser, updateUser } from '$lib/server/userService';
import { log } from '$lib/server/log';
import { safeKV, safeDO } from '$lib/server/env';

// [!code ++] Add PUT handler for profile updates
export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	try {
		const user = locals.user as any;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		if (!env || !env.BETA_USERS_KV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		const body: any = await request.json();

		// Validate inputs
		if (!body.name && !body.email) {
			return json({ error: 'No data to update' }, { status: 400 });
		}

		// Update the core user record in KV (cast KV typing to any)
		await updateUser(env.BETA_USERS_KV as any, (user as any).id, {
			name: body.name,
			email: body.email
		});

		return json({ success: true, user: { ...user, ...body } });
	} catch (err: any) {
		log.error('Update profile error', { message: err?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, platform, cookies }) => {
	try {
		const user = locals.user as any;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		if (!env || !env.BETA_USERS_KV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		await deleteUser(safeKV(env, 'BETA_USERS_KV')!, user.id, {
			tripsKV: safeKV(env, 'BETA_LOGS_KV')!,
			settingsKV: safeKV(env, 'BETA_USER_SETTINGS_KV'),
			tripIndexDO: safeDO(env, 'TRIP_INDEX_DO')!
		});

		// Cleanup Cookies
		cookies.delete('session_id', { path: '/' });
		cookies.delete('token', { path: '/' });

		return json({ success: true });
	} catch (err: any) {
		log.error('Delete account error', { message: err?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
