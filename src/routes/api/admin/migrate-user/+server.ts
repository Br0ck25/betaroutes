import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeKV } from '$lib/server/env';
import { findUserById, findUserByUsername } from '$lib/server/userService';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// Authz
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if ((locals.user as any).role !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

	const env = getEnv(platform);
	const usersKV = safeKV(env, 'BETA_USERS_KV');
	const logsKV = safeKV(env, 'BETA_LOGS_KV');

	if (!usersKV) return json({ error: 'Service Unavailable' }, { status: 503 });

	const body = await request.json().catch(() => ({}) as any);
	const {
		userId,
		username,
		mode = 'rebuild',
		force = false
	} = body as {
		userId?: string;
		username?: string;
		mode?: 'move' | 'rebuild';
		force?: boolean;
	};

	try {
		let id = userId;
		let name = username;

		if (!id && !name) return json({ error: 'userId or username required' }, { status: 400 });

		if (!id && name) {
			const user = await findUserByUsername(usersKV, name);
			if (!user) return json({ error: 'User not found' }, { status: 404 });
			id = user.id;
			name = user.username;
		}

		if (!name && id) {
			const user = await findUserById(usersKV, id);
			if (!user) return json({ error: 'User not found' }, { status: 404 });
			name = user.username;
		}

		// Import migration utility lazily
		const { migrateUserStorageKeys } = await import('$lib/server/migration/storage-key-migration');
		const result = await migrateUserStorageKeys(
			{
				BETA_LOGS_KV: logsKV,
				BETA_EXPENSES_KV: safeKV(env, 'BETA_EXPENSES_KV'),
				BETA_MILLAGE_KV: safeKV(env, 'BETA_MILLAGE_KV'),
				BETA_TRASH_KV: safeKV(env, 'BETA_TRASH_KV'),
				BETA_HUGHESNET_KV: safeKV(env, 'BETA_HUGHESNET_KV'),
				BETA_HUGHESNET_ORDERS_KV: safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')
			} as any,
			id as string,
			name as string,
			{ mode, force }
		);

		return json({ ok: true, result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('[Admin:MigrateUser] Failed', { message: msg });
		return json({ error: 'Migration failed', message: msg }, { status: 500 });
	}
};
