// src/routes/api/admin/migration/+server.ts
import { json } from '@sveltejs/kit';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { findUserByUsername } from '$lib/server/userService';

export const POST = async ({ request, locals, platform }: any) => {
	try {
		// Auth check (authorize using authoritative user core in USERS KV)
		const maybeUser = locals.user as { id?: string } | undefined;
		if (!maybeUser?.id) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const env = getEnv(platform as any);
		const usersKV = safeKV(env, 'BETA_USERS_KV');
		if (!usersKV) {
			return json({ error: 'Users KV not available' }, { status: 503 });
		}

		// Verify admin role from the canonical user record (no trust of client-provided role)
		const coreRaw = await usersKV.get(maybeUser.id);
		if (!coreRaw) return json({ error: 'Forbidden' }, { status: 403 });
		try {
			const core = JSON.parse(coreRaw as string) as Record<string, unknown>;
			if ((core['role'] as string | undefined) !== 'admin') {
				return json({ error: 'Forbidden' }, { status: 403 });
			}
		} catch {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const body = (await request.json()) as { users?: string[]; apply?: boolean };
		const targetUsers = body.users || [];
		const apply = !!body.apply;

		if (!Array.isArray(targetUsers) || targetUsers.length === 0) {
			return json({ error: 'No users specified' }, { status: 400 });
		}

		const results: Record<string, unknown> = {};
		for (const u of targetUsers) {
			try {
				// Resolve username -> userId if needed
				let userId = u;
				let userName = u;
				if (!/^[0-9a-fA-F-]{36}$/.test(u)) {
					const found = await findUserByUsername(usersKV, u);
					if (!found) {
						results[u] = { error: 'User not found' };
						continue;
					}
					userId = found.id;
					userName = found.username;
				}

				const migrationModule = await import('$lib/server/migration/storage-key-migration');
				let res: unknown;
				if (apply && migrationModule.runBatchedMigration) {
					// Admin requested apply: run the batched runner to completion (bounded iterations)
					res = await migrationModule.runBatchedMigration(getEnv(platform), userId, userName, {
						apply: true,
						batchLimit: 500,
						maxIterations: 50
					});
				} else if (migrationModule.migrateUserStorageKeys) {
					// Dry-run or single-batch check
					res = await migrationModule.migrateUserStorageKeys(getEnv(platform), userId, userName, {
						apply: !!apply,
						batchLimit: 500
					});
				} else {
					res = { error: 'Migration module missing' };
				}
				// Attach migration state if available
				const migrationsKV = safeKV(env, 'BETA_MIGRATIONS_KV');
				if (migrationsKV) {
					try {
						const state = await migrationsKV.get(`migration:${userId}:state`);
						const doState = await migrationsKV.get(`migration:${userId}:do:state`);
						if (state) (res as any).migrationState = JSON.parse(state as string);
						if (doState) (res as any).doMigrationState = JSON.parse(doState as string);
					} catch (e) {
						log.warn('[ADMIN/MIGRATE] Failed to read migration state', { user: userId, err: e });
					}
				}

				// Optionally run DO repair and surface result
				if (apply && migrationModule.repairDOIndex) {
					try {
						const repairRes = await migrationModule.repairDOIndex(getEnv(platform), userId);
						(res as any).doRepair = repairRes;
					} catch (e) {
						log.warn('[ADMIN/MIGRATE] DO repair failed', { user: userId, err: e });
					}
				}

				results[u] = res;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				results[u] = { error: msg };
				log.error('[ADMIN/MIGRATE] User migration failed', { user: u, message: msg });
			}
		}

		return json({ success: true, results });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('POST /api/admin/migration error', { message: msg });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
