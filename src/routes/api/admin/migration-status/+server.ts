import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if ((locals.user as any).role !== 'admin') return json({ error: 'Forbidden' }, { status: 403 });

	const env = getEnv(platform);
	const usersKV = safeKV(env, 'BETA_USERS_KV');
	const logsKV = safeKV(env, 'BETA_LOGS_KV');
	if (!usersKV) return json({ error: 'Service Unavailable' }, { status: 503 });

	const limit = Number(url.searchParams.get('limit') ?? 100);
	const cursor = url.searchParams.get('cursor') ?? undefined;

	try {
		const list = await usersKV.list({
			prefix: 'idx:username:',
			limit: Math.min(limit, 500),
			cursor
		});

		// More reliable: read the value to get userId
		const out: Array<{ username: string; userId?: string; migrated?: boolean }> = [];
		for (const key of list.keys) {
			const username = key.name.replace(/^idx:username:/, '');
			const id = await usersKV.get(key.name);
			const migrated = logsKV
				? !!(await logsKV.get(`migration:username_to_id:completed:${id}`))
				: false;
			out.push({ username, userId: id ?? undefined, migrated });
		}

		return json({ ok: true, cursor: (list as any).cursor ?? null, users: out });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('[Admin:MigrationStatus] Failed', { message: msg });
		return json({ error: 'Failed to list users', message: msg }, { status: 500 });
	}
};
