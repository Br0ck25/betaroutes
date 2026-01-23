/**
 * Migration Worker: username-based KV keys -> userId-based keys
 *
 * Designed to run as a one-off Cloudflare Worker (via Wrangler) that processes
 * keys in batches. Safe defaults: dryRun=true, backup=true, no deletion.
 *
 * How to use (example):
 * 1. Deploy with KV binding: "DATA_KV" (or edit the name below to match your binding).
 * 2. POST JSON to the worker endpoint with options (see README section below).
 *
 * NOTE: This worker expects you to supply a name->id mapping (recommended). If you
 * provide no mapping, the worker will attempt a limited heuristic lookup using
 * `env.USERS_KV` or `env.AUTH_KV` if those bindings are configured.
 *
 * Safety: dry-run mode only reads and logs actions. To perform writes set "dryRun": false
 * and set "confirm": true. Run in small batches first and validate results.
 */

export interface Env {
	DATA_KV: KVNamespace; // primary KV containing trip/expense/etc keys
	USERS_KV?: KVNamespace; // optional kv that maps username -> user record (heuristic)
	AUTH_KV?: KVNamespace; // optional auth KV
	MIGRATION_LOG_KV?: KVNamespace; // optional logging/metrics KV
}

const DEFAULT_BATCH_SIZE = 50; // how many keys to process per invocation
const DEFAULT_PREFIXES = ['expense:', 'mileage:', 'trip:', 'hns:settings:', 'settings:'];

function nowISO() {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

async function safeGet(kv: KVNamespace, key: string) {
	try {
		const v = await kv.get(key, { type: 'arrayBuffer' });
		return v;
	} catch (e) {
		console.error('KV.get error', key, String(e));
		return null;
	}
}

async function safePut(kv: KVNamespace, key: string, value: ArrayBuffer) {
	try {
		await kv.put(key, value);
		return true;
	} catch (e) {
		console.error('KV.put error', key, String(e));
		return false;
	}
}

async function safeDelete(kv: KVNamespace, key: string) {
	try {
		await kv.delete(key);
		return true;
	} catch (e) {
		console.error('KV.delete error', key, String(e));
		return false;
	}
}

function arrayBufferEquals(a?: ArrayBuffer | null, b?: ArrayBuffer | null) {
	if (!a || !b) return false;
	if (a.byteLength !== b.byteLength) return false;
	const av = new Uint8Array(a);
	const bv = new Uint8Array(b);
	for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
	return true;
}

// Attempts to resolve username -> userId. Prefer supplied map, then heuristics.
async function resolveUserId(
	env: Env,
	username: string,
	nameToId: Record<string, string> | undefined
) {
	if (nameToId && nameToId[username]) return nameToId[username];

	// Heuristic lookups - optional KVs
	const candidateKeys = [`user:${username}`, `users:${username}`, `username:${username}`];

	if (env.USERS_KV) {
		for (const k of candidateKeys) {
			const raw = (await env.USERS_KV.get(k, { type: 'json' })) as Record<string, unknown> | null;
			const id = getStringField(raw, 'id', 'userId');
			if (id) return id;
			// some records store {name, id}
			const name = getStringField(raw, 'name');
			if (name === username) {
				const id2 = getStringField(raw, 'id');
				if (id2) return id2;
			}
		}
	}

	if (env.AUTH_KV) {
		for (const k of candidateKeys) {
			const raw = (await env.AUTH_KV.get(k, { type: 'json' })) as Record<string, unknown> | null;
			const id = getStringField(raw, 'id', 'userId');
			if (id) return id;
		}
	}

	return null; // unresolved - must be provided by operator mapping
}

function parseKeySegments(key: string) {
	return key.split(':');
}

function targetKeyFor(originalKey: string, userId: string) {
	// Handle known patterns
	// Examples:
	// expense:James:UUID -> expense:{userId}:UUID
	// trip:James:hns_James_2025-09-24 -> trip:{userId}:hns_{userId}_2025-09-24
	// hns:settings:James -> hns:settings:{userId}

	const segs = parseKeySegments(originalKey);
	if (segs.length >= 3) {
		const [p1, p2] = segs;
		if (p1 === 'hns' && p2 === 'settings') {
			return `hns:settings:${userId}`;
		}
		// p1 = expense|mileage|trip
		// new key: `${p1}:${userId}:${rest...}` but for trip:hns_* we must replace embedded username
		const rest = segs.slice(2).join(':');
		if (p1 === 'trip' && rest.startsWith('hns_')) {
			// replace embedded hns_{username}_... with hns_{userId}_...
			const newRest = rest.replace(new RegExp(`hns_${escapeRegExp(segs[1])}`), `hns_${userId}`);
			return `${p1}:${userId}:${newRest}`;
		}
		return `${p1}:${userId}:${rest}`;
	}
	// fallback - prefix unknown, append userId
	return `${originalKey}:${userId}`;
}

function escapeRegExp(s: string) {
	return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function getStringField(obj: Record<string, unknown> | null | undefined, ...keys: string[]) {
	if (!obj) return undefined;
	for (const k of keys) {
		const v = (obj as Record<string, unknown>)[k];
		if (typeof v === 'string' && v.length) return v;
	}
	return undefined;
}

interface MigrateOptions {
	prefix: string;
	dryRun: boolean;
	nameToId?: Record<string, string>;
	batchSize: number;
	deleteOld: boolean;
	backup: boolean;
	cursor?: string | null;
}

interface MigrateResult {
	prefix: string;
	processed: number;
	migrated: number;
	conflicts: string[];
	unresolved: string[];
	nextCursor: string | null;
}

async function migrateKeysForPrefix(env: Env, options: MigrateOptions) {
	const { prefix, dryRun, nameToId, batchSize, deleteOld, backup, cursor } = options;
	const kv = env.DATA_KV;
	let nextCursor = cursor;
	let processed = 0;
	let migrated = 0;
	const conflicts: string[] = [];
	const unresolved: Set<string> = new Set();

	// Use list() with pagination. We'll take up to batchSize keys per invocation.
	const listRes = await kv.list({
		prefix,
		cursor: cursor ?? undefined,
		limit: Math.max(100, batchSize * 2)
	});
	nextCursor = listRes.list_complete ? null : listRes.cursor;
	const keys = listRes.keys.slice(0, batchSize);

	for (const meta of keys) {
		processed++;
		const key = meta.name;
		// Extract username from key patterns
		const segs = parseKeySegments(key);
		if (segs.length < 2) continue; // unexpected format
		// username is often segs[1] for patterns described
		const username = segs[1];
		const userId = await resolveUserId(env, username, nameToId);
		if (!userId) {
			unresolved.add(username);
			continue;
		}
		const targetKey = targetKeyFor(key, userId);

		const existingNew = await safeGet(kv, targetKey);
		const oldValue = await safeGet(kv, key);
		if (!oldValue) {
			console.warn('No value for', key);
			continue;
		}

		// Decide action
		if (existingNew) {
			if (arrayBufferEquals(existingNew, oldValue)) {
				// identical - safe to delete old key (if requested)
				if (!dryRun && deleteOld) {
					if (backup) await safePut(kv, `migration_backup:${nowISO()}:${key}`, oldValue);
					await safeDelete(kv, key);
				}
				migrated++;
				continue;
			} else {
				// conflict - different values
				conflicts.push(key);
				continue;
			}
		}

		// Write new key (or dry-run report)
		if (dryRun) {
			// Log what we would do
			console.log(`[dry-run] MOVE ${key} -> ${targetKey}`);
			migrated++;
			continue;
		}

		// backup old value before overwriting
		if (backup) await safePut(kv, `migration_backup:${nowISO()}:${key}`, oldValue);

		const okPut = await safePut(kv, targetKey, oldValue);
		if (!okPut) {
			console.error('Failed to put', targetKey);
			conflicts.push(key);
			continue;
		}
		// verify
		const verify = await safeGet(kv, targetKey);
		if (!arrayBufferEquals(verify, oldValue)) {
			console.error('Verification failed for', targetKey);
			conflicts.push(key);
			continue;
		}
		if (deleteOld) {
			const okDel = await safeDelete(kv, key);
			if (!okDel) {
				console.error('Failed to delete old key', key);
			}
		}
		migrated++;
	}

	// return summary
	return {
		prefix,
		processed,
		migrated,
		conflicts,
		unresolved: Array.from(unresolved),
		nextCursor
	};
}

export default {
	async fetch(request: Request, env: Env) {
		if (request.method !== 'POST') return new Response('POST required', { status: 405 });
		let body: Record<string, unknown> = {};
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}

		const dryRun = typeof body['dryRun'] === 'boolean' ? (body['dryRun'] as boolean) : true;
		const confirm = typeof body['confirm'] === 'boolean' ? (body['confirm'] as boolean) : false; // require explicit confirm to write/delete
		const deleteOld =
			typeof body['deleteOld'] === 'boolean' ? (body['deleteOld'] as boolean) : false;
		const backup = typeof body['backup'] === 'boolean' ? (body['backup'] as boolean) : true;
		const prefixes: string[] = Array.isArray(body['prefixes'])
			? (body['prefixes'] as string[])
			: DEFAULT_PREFIXES;
		const batchSize: number =
			typeof body['batchSize'] === 'number' ? (body['batchSize'] as number) : DEFAULT_BATCH_SIZE;
		const nameToId: Record<string, string> | undefined =
			body['nameToId'] && typeof body['nameToId'] === 'object'
				? (body['nameToId'] as Record<string, string>)
				: undefined;
		const cursorByPrefix: Record<string, string | null> =
			body['cursorByPrefix'] && typeof body['cursorByPrefix'] === 'object'
				? (body['cursorByPrefix'] as Record<string, string | null>)
				: {};

		if (!dryRun && !confirm) {
			return new Response(
				JSON.stringify({ error: 'confirm=true required to perform writes/deletes' }),
				{ status: 400 }
			);
		}

		const results: MigrateResult[] = [];
		for (const prefix of prefixes) {
			const r = await migrateKeysForPrefix(env, {
				prefix,
				dryRun,
				nameToId,
				batchSize,
				deleteOld,
				backup,
				cursor: cursorByPrefix[prefix]
			});
			results.push(r);
			// Small delay to be kind to KV subrequest limits in large jobs
			await new Promise((res) => setTimeout(res, 250));
		}

		// Save a compact migration summary to MIGRATION_LOG_KV if present
		if (env.MIGRATION_LOG_KV) {
			const id = `migration_summary:${nowISO()}`;
			try {
				await env.MIGRATION_LOG_KV.put(
					id,
					JSON.stringify({ time: new Date().toISOString(), dryRun, results })
				);
			} catch (e) {
				console.warn('Failed to write migration log', String(e));
			}
		}

		return new Response(JSON.stringify({ ok: true, dryRun, results }), { status: 200 });
	}
};

/**
 * README (short runbook)
 *
 * 1) BACKUP (mandatory)
 *    - Use `wrangler tail` or `wrangler kv:list` and export your keys, or run the worker in dry-run
 *      and then create backups from the UI. This worker writes backups under `migration_backup:{timestamp}:{key}` when `backup=true`.
 *
 * 2) PREPARE mapping
 *    - Create a `nameToId` JSON object mapping usernames (e.g., "James") to UUID ids.
 *    - If you don't have that mapping readily available, configure `USERS_KV` or `AUTH_KV` bindings
 *      and the worker will attempt heuristics to find an id for a username.
 *
 * 3) DRY RUN
 *    - Deploy the worker (wrangler) and POST with body: { "dryRun": true, "nameToId": { "James": "<uuid>" } }
 *    - Inspect the returned `results` and the `migration_summary` in `MIGRATION_LOG_KV` if available.
 *
 * 4) RUN SMALL BATCHES
 *    - Use `batchSize: 50` (default). Repeat invocations until `nextCursor` is null for each prefix.
 *    - Example: POST { dryRun:false, confirm:true, deleteOld:false, nameToId:{...}, batchSize:50 }
 *
 * 5) VERIFY
 *    - Run KV scans for username patterns: e.g., `kv.list({ prefix: 'expense:James:' })` should return zero results.
 *    - Randomly sample migrated records, inspect payload, and verify owner id fields where applicable.
 *
 * 6) CUTOVER
 *    - After confidence is high, change code `getStorageId()` to `return user?.id || ''` in `src/lib/server/user.ts`.
 *
 * 7) CLEANUP
 *    - When satisfied, run again with deleteOld:true and confirm to remove legacy keys. Optionally remove `migration_backup:*` after retention period.
 *
 * 8) ROLLBACK
 *    - Backups are stored under `migration_backup:{timestamp}:{origKey}` in the same KV.
 *    - To rollback: copy from backup keys back to original key names.
 *
 */
