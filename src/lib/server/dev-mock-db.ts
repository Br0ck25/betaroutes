// src/lib/server/dev-mock-db.ts
// IMPORTANT: Do NOT use top-level imports for node:fs or node:path
// Those will be bundled into the Cloudflare Workers output and crash at runtime.
// Instead, we use lazy imports inside functions to ensure proper tree-shaking.

import { env as privateEnv } from '$env/dynamic/private';
import { log } from '$lib/server/log';

// Lazily loaded Node.js modules (only in dev/test environment)
let _fs: typeof import('node:fs') | null = null;
let _path: typeof import('node:path') | null = null;
let _dbFile: string | null = null;

async function getNodeModules() {
	if (!_fs) {
		_fs = await import('node:fs');
		_path = await import('node:path');
		_dbFile = _path.resolve('.kv-mock.json');
	}
	return { fs: _fs, path: _path!, dbFile: _dbFile! };
}

// Helper for safe sorting to prevent runtime crashes (matches TripIndexDO logic)
function getSortValue(t: unknown): string {
	if (!t || typeof t !== 'object') return '';
	const obj = t as Record<string, unknown>;
	const val = (obj['date'] ?? obj['createdAt']) as unknown;
	return typeof val === 'string' ? val : '';
}

// Initial state
let mockDB: Record<string, Record<string, unknown>> = {
	USERS: {},
	SESSIONS: {},
	LOGS: {},
	TRASH: {},
	SETTINGS: {},
	HUGHESNET: {},
	HUGHESNET_ORDERS: {},
	PLACES: {},
	INDEXES: {} // [!code ++] New storage for Trip Indexes
};

let _initialized = false;

// Load existing data (called lazily on first setupMockKV)
async function initMockDB() {
	if (_initialized) return;
	_initialized = true;

	try {
		const { fs, dbFile } = await getNodeModules();
		if (fs.existsSync(dbFile)) {
			const raw = fs.readFileSync(dbFile, 'utf-8');
			const loaded = JSON.parse(raw);
			mockDB = { ...mockDB, ...loaded };

			// Ensure namespaces exist
			['HUGHESNET', 'HUGHESNET_ORDERS', 'PLACES', 'SESSIONS', 'INDEXES'].forEach((ns) => {
				if (!mockDB[ns]) mockDB[ns] = {};
			});

			log.debug('📂 Loaded mock KV data from .kv-mock.json');
		}
	} catch (e) {
		log.error('Failed to load mock DB', e);
	}
}

// Save helper (async to support lazy imports)
async function saveDB() {
	try {
		const { fs, dbFile } = await getNodeModules();
		fs.writeFileSync(dbFile, JSON.stringify(mockDB, null, 2));
	} catch (e) {
		log.error('Failed to save mock DB', e);
	}
}

// Factory function for KV
function createMockKV(namespace: string) {
	return {
		async get(key: string) {
			const ns = mockDB[namespace] as Record<string, unknown> | undefined;
			return (ns?.[key] as string) ?? null;
		},
		async put(key: string, value: string) {
			// log.debug(`[MOCK KV ${namespace}] PUT ${key}`);
			if (!mockDB[namespace]) mockDB[namespace] = {};
			const ns = mockDB[namespace] as Record<string, unknown>;
			ns[key] = value;
			await saveDB();
		},
		async delete(key: string) {
			// log.debug(`[MOCK KV ${namespace}] DELETE ${key}`);
			if (mockDB[namespace]) {
				const ns = mockDB[namespace] as Record<string, unknown>;
				delete ns[key];
				await saveDB();
			}
		},
		async list({ prefix }: { prefix: string }) {
			if (!mockDB[namespace]) return { keys: [] };
			const ns = mockDB[namespace] as Record<string, unknown>;
			const keys = Object.keys(ns)
				.filter((k) => k.startsWith(prefix))
				.map((name) => ({ name }));
			return { keys };
		}
	};
}

// [!code ++] Factory function for Durable Object Stub
function createMockDOStub(id: string) {
	return {
		async fetch(urlOrRequest: string | Request, init?: RequestInit) {
			const url =
				typeof urlOrRequest === 'string' ? new URL(urlOrRequest) : new URL(urlOrRequest.url);
			const path = url.pathname;

			// Init storage for this user/id if missing
			if (!mockDB['INDEXES']) mockDB['INDEXES'] = {};
			if (!mockDB['INDEXES'][id]) {
				mockDB['INDEXES'][id] = { trips: [], initialized: false, billing: {} };
			}
			const storage = mockDB['INDEXES'][id] as {
				trips: unknown[];
				initialized: boolean;
				billing: Record<string, number>;
			};

			// --- MOCK API HANDLERS ---

			if (path === '/list') {
				// Simulate migration check
				if (!storage.initialized) {
					return new Response(JSON.stringify({ needsMigration: true }));
				}
				return new Response(JSON.stringify(storage.trips));
			}

			if (path === '/migrate') {
				const body = JSON.parse((init?.body as string) || '[]');
				storage.trips = body;
				storage.initialized = true;
				await saveDB();
				return new Response('OK');
			}

			if (path === '/put') {
				const trip = JSON.parse(init?.body as string);
				const idx = storage.trips.findIndex(
					(t: unknown) =>
						(t as Record<string, unknown>)['id'] === (trip as Record<string, unknown>)['id']
				);
				if (idx >= 0) storage.trips[idx] = trip;
				else storage.trips.push(trip);

				// Safe Sort desc
				storage.trips.sort((a: unknown, b: unknown) =>
					getSortValue(b).localeCompare(getSortValue(a))
				);
				await saveDB();
				return new Response('OK');
			}

			if (path === '/delete') {
				const { id: tripId } = JSON.parse(init?.body as string);
				storage.trips = storage.trips.filter(
					(t: unknown) => (t as Record<string, unknown>)['id'] !== tripId
				);
				await saveDB();
				return new Response('OK');
			}

			// Mock Billing Check
			if (path === '/billing/check-increment') {
				const { monthKey, limit } = JSON.parse(init?.body as string);
				const current = storage.billing[monthKey] || 0;
				if (current >= limit) {
					return new Response(JSON.stringify({ allowed: false, count: current }));
				}
				storage.billing[monthKey] = current + 1;
				await saveDB();
				return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
			}

			if (path === '/billing/decrement') {
				const { monthKey } = JSON.parse(init?.body as string);
				const current = storage.billing[monthKey] || 0;
				const next = Math.max(0, current - 1);
				storage.billing[monthKey] = next;
				await saveDB();
				return new Response(JSON.stringify({ count: next }));
			}

			return new Response('Not Found', { status: 404 });
		}
	};
}

/**
 * Main Setup Function
 */
export async function setupMockKV(event: { platform?: { env?: Record<string, unknown> } }) {
	// Load mock DB from disk on first call
	await initMockDB();

	if (!event.platform) event.platform = { env: {} };
	if (!event.platform.env) event.platform.env = {};

	const env = event.platform.env as Record<string, unknown>;

	if (!env['PRIVATE_GOOGLE_MAPS_API_KEY']) {
		env['PRIVATE_GOOGLE_MAPS_API_KEY'] = privateEnv['PRIVATE_GOOGLE_MAPS_API_KEY'];
	}

	// Mock KVs
	if (!env['BETA_SESSIONS_KV']) env['BETA_SESSIONS_KV'] = createMockKV('SESSIONS');
	if (!env['BETA_USERS_KV']) env['BETA_USERS_KV'] = createMockKV('USERS');
	if (!env['BETA_LOGS_KV']) env['BETA_LOGS_KV'] = createMockKV('LOGS');
	if (!env['BETA_USER_SETTINGS_KV']) env['BETA_USER_SETTINGS_KV'] = createMockKV('SETTINGS');
	if (!env['BETA_PLACES_KV']) env['BETA_PLACES_KV'] = createMockKV('PLACES');
	if (!env['BETA_EXPENSES_KV']) env['BETA_EXPENSES_KV'] = createMockKV('EXPENSES');
	if (!env['BETA_MILEAGE_KV']) env['BETA_MILEAGE_KV'] = createMockKV('MILEAGE');
	if (!env['BETA_HUGHESNET_KV']) env['BETA_HUGHESNET_KV'] = createMockKV('HUGHESNET');
	if (!env['BETA_HUGHESNET_ORDERS_KV'])
		env['BETA_HUGHESNET_ORDERS_KV'] = createMockKV('HUGHESNET_ORDERS');

	// [!code ++] Mock Durable Object Binding
	if (!env['TRIP_INDEX_DO']) {
		env['TRIP_INDEX_DO'] = {
			idFromName: (name: string) => ({ toString: () => name }), // Use name as ID for mock
			get: (id: unknown) => createMockDOStub(String(id))
		};
	}
}

// Helper to seed session entries directly into the in-memory mock DB used by tests
export async function seedMockSession(sessionId: string, user: Record<string, unknown>) {
	await initMockDB();
	if (!mockDB['SESSIONS']) mockDB['SESSIONS'] = {};
	mockDB['SESSIONS'][sessionId] = JSON.stringify(user);
	await saveDB();
}
