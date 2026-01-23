// migrate-username-to-id worker entry
// Copied from repository's tools/migrations/migrate-username-to-id/worker.ts
// Ensure this file is kept in-sync with the canonical implementation in tools/migrations.

export interface Env {
	DATA_KV: KVNamespace;
	USERS_KV?: KVNamespace;
	AUTH_KV?: KVNamespace;
	MIGRATION_LOG_KV?: KVNamespace;
}

const DEFAULT_BATCH_SIZE = 50;
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

async function resolveUserId(env: Env, username: string, nameToId: Record<string, string> | undefined) {
	if (nameToId && nameToId[username]) return nameToId[username];

	const candidateKeys = [`user:${username}`, `users:${username}`, `username:${username}`];

	if (env.USERS_KV) {
		for (const k of candidateKeys) {
			const raw = (await env.USERS_KV.get(k, { type: 'json' })) as Record<string, unknown> | null;
			const id = getStringField(raw, 'id', 'userId');
			if (id) return id;
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

	return null;
}

function parseKeySegments(key: string) {
	return key.split(':');
}

function targetKeyFor(originalKey: string, userId: string) {
	const segs = parseKeySegments(originalKey);
	if (segs.length >= 3) {
		const [p1, p2] = segs;
		if (p1 === 'hns' && p2 === 'settings') {
			return `hns:settings:${userId}`;
		}
		const rest = segs.slice(2).join(':');
		if (p1 === 'trip' && rest.startsWith('hns_')) {
			const newRest = rest.replace(new RegExp(`hns_${escapeRegExp(segs[1])}`), `hns_${userId}`);
			return `${p1}:${userId}:${newRest}`;
		}
		return `${p1}:${userId}:${rest}`;
	}
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

	const listRes = await kv.list({
		prefix,
		cursor: cursor ?? undefined,
		limit: Math.max(100, batchSize * 2),
	});
	nextCursor = listRes.list_complete ? null : listRes.cursor;
	const keys = listRes.keys.slice(0, batchSize);

	for (const meta of keys) {
		processed++;
		const key = meta.name;
		const segs = parseKeySegments(key);
		if (segs.length < 2) continue;
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

		if (existingNew) {
			if (arrayBufferEquals(existingNew, oldValue)) {
				if (!dryRun && deleteOld) {
					if (backup) await safePut(kv, `migration_backup:${nowISO()}:${key}`, oldValue);
					await safeDelete(kv, key);
				}
				migrated++;
				continue;
			} else {
				conflicts.push(key);
				continue;
			}
		}

		if (dryRun) {
			console.log(`[dry-run] MOVE ${key} -> ${targetKey}`);
			migrated++;
			continue;
		}

		if (backup) await safePut(kv, `migration_backup:${nowISO()}:${key}`, oldValue);
		const okPut = await safePut(kv, targetKey, oldValue);
		if (!okPut) {
			console.error('Failed to put', targetKey);
			conflicts.push(key);
			continue;
		}
		const verify = await safeGet(kv, targetKey);
		if (!arrayBufferEquals(verify, oldValue)) {
			console.error('Verification failed for', targetKey);
			conflicts.push(key);
			continue;
		}
		if (deleteOld) {
			const okDel = await safeDelete(kv, key);
			if (!okDel) console.error('Failed to delete old key', key);
		}
		migrated++;
	}

	return { prefix, processed, migrated, conflicts, unresolved: Array.from(unresolved), nextCursor };
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
		const confirm = typeof body['confirm'] === 'boolean' ? (body['confirm'] as boolean) : false;
		const deleteOld = typeof body['deleteOld'] === 'boolean' ? (body['deleteOld'] as boolean) : false;
		const backup = typeof body['backup'] === 'boolean' ? (body['backup'] as boolean) : true;
		const prefixes: string[] = Array.isArray(body['prefixes']) ? (body['prefixes'] as string[]) : DEFAULT_PREFIXES;
		const batchSize: number = typeof body['batchSize'] === 'number' ? (body['batchSize'] as number) : DEFAULT_BATCH_SIZE;
		const nameToId: Record<string, string> | undefined =
			body['nameToId'] && typeof body['nameToId'] === 'object' ? (body['nameToId'] as Record<string, string>) : undefined;
		const cursorByPrefix: Record<string, string | null> =
			body['cursorByPrefix'] && typeof body['cursorByPrefix'] === 'object' ? (body['cursorByPrefix'] as Record<string, string | null>) : {};

		if (!dryRun && !confirm) {
			return new Response(JSON.stringify({ error: 'confirm=true required to perform writes/deletes' }), { status: 400 });
		}

		const results: MigrateResult[] = [];
		for (const prefix of prefixes) {
			const r = await migrateKeysForPrefix(env, { prefix, dryRun, nameToId, batchSize, deleteOld, backup, cursor: cursorByPrefix[prefix] });
			results.push(r);
			await new Promise((res) => setTimeout(res, 250));
		}

		if (env.MIGRATION_LOG_KV) {
			const id = `migration_summary:${nowISO()}`;
			try {
				await env.MIGRATION_LOG_KV.put(id, JSON.stringify({ time: new Date().toISOString(), dryRun, results }));
			} catch {
				console.warn('Failed to write migration log');
			}
		}

		return new Response(JSON.stringify({ ok: true, dryRun, results }), { status: 200 });
	},
};
