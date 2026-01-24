import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { findUserByUsername } from '$lib/server/userService';

interface StatusRequestBody {
	users?: string[];
}

interface MigrationCounts {
	trip_legacy: number;
	trip_legacy_lower?: number;
	expense_legacy: number;
	mileage_legacy: number;
	trash_legacy: number;
	migrationState?: unknown;
	doMigrationState?: unknown;
	[k: string]: unknown;
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	// AUTH: verify admin role via USERS KV (do not trust client-provided role)
	const maybeUser = locals.user as { id?: string } | undefined;
	if (!maybeUser?.id) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = (await request.json()) as StatusRequestBody;
	const targetUsers = body.users || [];
	if (!Array.isArray(targetUsers) || targetUsers.length === 0) {
		return json({ error: 'No users specified' }, { status: 400 });
	}

	const env = getEnv(platform as any);
	const usersKV = safeKV(env, 'BETA_USERS_KV');
	if (!usersKV) {
		return json({ error: 'Users KV not available' }, { status: 503 });
	}

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

	const results: Record<string, unknown> = {};

	for (const u of targetUsers) {
		try {
			let userId = u;
			let userName = u;
			if (!/^[0-9a-fA-F-]{36}$/.test(u)) {
				const usersKV = safeKV(env, 'BETA_USERS_KV');
				if (!usersKV) {
					results[u] = { error: 'Users KV not available' };
					continue;
				}
				const found = await findUserByUsername(usersKV, u);
				if (!found) {
					results[u] = { error: 'User not found' };
					continue;
				}
				userId = found.id;
				userName = found.username;
			}

			// Gather counts
			const tripKV = safeKV(env, 'BETA_LOGS_KV');
			const expensesKV = safeKV(env, 'BETA_EXPENSES_KV');
			const mileageKV = safeKV(env, 'BETA_MILLAGE_KV');
			const trashKV = safeKV(env, 'BETA_TRASH_KV');
			const migrationsKV = safeKV(env, 'BETA_MIGRATIONS_KV');

			const counts: MigrationCounts = {
				trip_legacy: 0,
				expense_legacy: 0,
				mileage_legacy: 0,
				trash_legacy: 0
			};

			const listCount = async (kv: unknown, prefix: string) => {
				if (!kv) return 0;
				const k = kv as unknown as KVNamespace;
				let total = 0;
				let list = await k.list({ prefix, limit: 1000 });
				total += list.keys.length;
				while (!list.list_complete && (list as unknown as { cursor?: string }).cursor) {
					list = await k.list({
						prefix,
						cursor: (list as unknown as { cursor?: string }).cursor,
						limit: 1000
					});
					total += list.keys.length;
				}
				return total;
			};

			// Trips: legacy prefixes that may have been username or lowercase username
			counts.trip_legacy = await listCount(tripKV, `trip:${userName}:`);
			counts.trip_legacy_lower = await listCount(tripKV, `trip:${userName.toLowerCase()}:`);
			counts.expense_legacy = await listCount(expensesKV, `expense:${userName}:`);
			counts.mileage_legacy = await listCount(mileageKV, `mileage:${userName}:`);

			// Trash: scan trash: and filter by metadata.userId field (best effort)
			if (trashKV) {
				const k = trashKV as unknown as KVNamespace;
				let list = await k.list({ prefix: 'trash:', limit: 1000 });
				let trashCount = 0;
				for (const { name } of list.keys) {
					const raw = await k.get(name);
					if (!raw) continue;
					try {
						const parsed = JSON.parse(raw as string) as Record<string, unknown>;
						if (
							(parsed['userId'] as string) === userName ||
							(parsed['userId'] as string) === userId
						)
							trashCount++;
					} catch {
						// ignore corrupt
					}
				}
				while (!list.list_complete && (list as unknown as { cursor?: string }).cursor) {
					list = await k.list({
						prefix: 'trash:',
						cursor: (list as unknown as { cursor?: string }).cursor,
						limit: 1000
					});
					for (const { name } of list.keys) {
						const raw = await k.get(name);
						if (!raw) continue;
						try {
							const parsed = JSON.parse(raw as string) as Record<string, unknown>;
							if (
								(parsed['userId'] as string) === userName ||
								(parsed['userId'] as string) === userId
							)
								trashCount++;
						} catch {
							// ignore
						}
					}
				}
				counts.trash_legacy = trashCount;
			} else {
				counts.trash_legacy = 0;
			}

			// Include persisted migration cursors/state if present
			if (migrationsKV) {
				try {
					const state = await (migrationsKV as unknown as KVNamespace).get(
						`migration:${userId}:state`
					);
					const doState = await (migrationsKV as unknown as KVNamespace).get(
						`migration:${userId}:do:state`
					);
					if (state) counts.migrationState = JSON.parse(state as string);
					if (doState) counts.doMigrationState = JSON.parse(doState as string);
				} catch (e) {
					log.warn('[ADMIN/MIGRATE/STATUS] failed to read migrations state', { userId, err: e });
				}
			}

			results[u] = counts;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results[u] = { error: msg };
			log.error('[ADMIN/MIGRATE/STATUS] failed for user', { user: u, message: msg });
		}
	}

	return json({ success: true, results });
};
