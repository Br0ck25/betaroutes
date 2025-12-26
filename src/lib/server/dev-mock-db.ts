// src/lib/server/dev-mock-db.ts
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE_GOOGLE_MAPS_API_KEY } from '$env/static/private';

const DB_FILE = path.resolve('.kv-mock.json');

// Helper for safe sorting to prevent runtime crashes (matches TripIndexDO logic)
function getSortValue(t: any): string {
    if (!t) return "";
    const val = t.date || t.createdAt;
    return typeof val === 'string' ? val : "";
}

// Initial state
let mockDB: Record<string, any> = {
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

// Load existing data
try {
	if (fs.existsSync(DB_FILE)) {
		const raw = fs.readFileSync(DB_FILE, 'utf-8');
		const loaded = JSON.parse(raw);
		mockDB = { ...mockDB, ...loaded };
		
		// Ensure namespaces exist
		['HUGHESNET', 'HUGHESNET_ORDERS', 'PLACES', 'SESSIONS', 'INDEXES'].forEach(ns => {
			if (!mockDB[ns]) mockDB[ns] = {};
		});
		
		console.log('📂 Loaded mock KV data from .kv-mock.json');
	}
} catch (e) {
	console.error('Failed to load mock DB', e);
}

// Save helper
function saveDB() {
	try {
		fs.writeFileSync(DB_FILE, JSON.stringify(mockDB, null, 2));
	} catch (e) {
		console.error('Failed to save mock DB', e);
	}
}

// Factory function for KV
function createMockKV(namespace: string) {
	return {
		async get(key: string) {
			return mockDB[namespace][key] ?? null;
		},
		async put(key: string, value: string) {
			// console.log(`[MOCK KV ${namespace}] PUT ${key}`);
			if (!mockDB[namespace]) mockDB[namespace] = {}; 
			mockDB[namespace][key] = value;
			saveDB(); 
		},
		async delete(key: string) {
			// console.log(`[MOCK KV ${namespace}] DELETE ${key}`);
			if (mockDB[namespace]) {
				delete mockDB[namespace][key];
				saveDB(); 
			}
		},
		async list({ prefix }: { prefix: string }) {
			if (!mockDB[namespace]) return { keys: [] };
			const keys = Object.keys(mockDB[namespace])
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
			const url = typeof urlOrRequest === 'string' ? new URL(urlOrRequest) : new URL(urlOrRequest.url);
			const path = url.pathname;
			
			// Init storage for this user/id if missing
			if (!mockDB.INDEXES[id]) {
				mockDB.INDEXES[id] = { trips: [], initialized: false, billing: {} };
			}
			const storage = mockDB.INDEXES[id];

			// --- MOCK API HANDLERS ---

			if (path === '/list') {
				// Simulate migration check
				if (!storage.initialized) {
					return new Response(JSON.stringify({ needsMigration: true }));
				}
				return new Response(JSON.stringify(storage.trips));
			}

			if (path === '/migrate') {
				const body = JSON.parse(init?.body as string || '[]');
				storage.trips = body;
				storage.initialized = true;
				saveDB();
				return new Response("OK");
			}

			if (path === '/put') {
				const trip = JSON.parse(init?.body as string);
				const idx = storage.trips.findIndex((t: any) => t.id === trip.id);
				if (idx >= 0) storage.trips[idx] = trip;
				else storage.trips.push(trip);
				
				// Safe Sort desc
				storage.trips.sort((a: any, b: any) => 
                    getSortValue(b).localeCompare(getSortValue(a))
                );
				saveDB();
				return new Response("OK");
			}

			if (path === '/delete') {
				const { id: tripId } = JSON.parse(init?.body as string);
				storage.trips = storage.trips.filter((t: any) => t.id !== tripId);
				saveDB();
				return new Response("OK");
			}

			// Mock Billing Check
			if (path === '/billing/check-increment') {
				const { monthKey, limit } = JSON.parse(init?.body as string);
				const current = storage.billing[monthKey] || 0;
				if (current >= limit) {
					return new Response(JSON.stringify({ allowed: false, count: current }));
				}
				storage.billing[monthKey] = current + 1;
				saveDB();
				return new Response(JSON.stringify({ allowed: true, count: current + 1 }));
			}
			
			if (path === '/billing/decrement') {
				const { monthKey } = JSON.parse(init?.body as string);
				const current = storage.billing[monthKey] || 0;
				const next = Math.max(0, current - 1);
				storage.billing[monthKey] = next;
				saveDB();
				return new Response(JSON.stringify({ count: next }));
			}

			return new Response("Not Found", { status: 404 });
		}
	};
}

/**
 * Main Setup Function
 */
export function setupMockKV(event: any) {
	if (!event.platform) event.platform = { env: {} };
	if (!event.platform.env) event.platform.env = {};

	const env = event.platform.env;

	if (!env.PRIVATE_GOOGLE_MAPS_API_KEY) {
		env.PRIVATE_GOOGLE_MAPS_API_KEY = PRIVATE_GOOGLE_MAPS_API_KEY;
	}

	// Mock KVs
	if (!env.BETA_SESSIONS_KV) env.BETA_SESSIONS_KV = createMockKV('SESSIONS');
	if (!env.BETA_USERS_KV) env.BETA_USERS_KV = createMockKV('USERS');
	if (!env.BETA_LOGS_KV) env.BETA_LOGS_KV = createMockKV('LOGS');
	if (!env.BETA_LOGS_TRASH_KV) env.BETA_LOGS_TRASH_KV = createMockKV('TRASH');
	if (!env.BETA_USER_SETTINGS_KV) env.BETA_USER_SETTINGS_KV = createMockKV('SETTINGS');
	if (!env.BETA_PLACES_KV) env.BETA_PLACES_KV = createMockKV('PLACES');
	if (!env.BETA_HUGHESNET_KV) env.BETA_HUGHESNET_KV = createMockKV('HUGHESNET');
	if (!env.BETA_HUGHESNET_ORDERS_KV) env.BETA_HUGHESNET_ORDERS_KV = createMockKV('HUGHESNET_ORDERS');

	// [!code ++] Mock Durable Object Binding
	if (!env.TRIP_INDEX_DO) {
		env.TRIP_INDEX_DO = {
			idFromName: (name: string) => ({ toString: () => name }), // Use name as ID for mock
			get: (id: any) => createMockDOStub(id.toString())
		};
	}
}