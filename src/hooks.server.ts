// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';

// File-based persistence for local dev
const DB_FILE = path.resolve('.kv-mock.json');

// Load or initialize DB
let mockDB: Record<string, any> = {
	USERS: {},
	LOGS: {},
	TRASH: {},
	SETTINGS: {},
	HUGHESNET: {},
	PLACES: {} // Ensure this exists
};

if (dev) {
	console.log(`[HOOKS] 📂 Mock DB Path: ${DB_FILE}`);
	try {
		if (fs.existsSync(DB_FILE)) {
			const raw = fs.readFileSync(DB_FILE, 'utf-8');
			const loaded = JSON.parse(raw);
			
			mockDB = { ...mockDB, ...loaded };
			
			// Ensure namespaces exist after load
			if (!mockDB.HUGHESNET) mockDB.HUGHESNET = {}; 
			if (!mockDB.PLACES) mockDB.PLACES = {}; 
			
			console.log('[HOOKS] ✅ Loaded mock KV data from disk');
		} else {
			console.log('[HOOKS] ⚠️ No .kv-mock.json found, creating new one on first save.');
		}
	} catch (e) {
		console.error('[HOOKS] ❌ Failed to load mock DB:', e);
	}
}

function saveDB() {
	if (!dev) return;
	try {
		fs.writeFileSync(DB_FILE, JSON.stringify(mockDB, null, 2));
	} catch (e) {
		console.error('[HOOKS] ❌ FAILED to save mock DB:', e);
	}
}

function createMockKV(namespace: string) {
	return {
		async get(key: string) {
			return mockDB[namespace]?.[key] ?? null;
		},
		async put(key: string, value: string) {
			console.log(`[MOCK KV ${namespace}] PUT ${key}`);
			if (!mockDB[namespace]) mockDB[namespace] = {}; 
			
			mockDB[namespace][key] = value;
			saveDB(); // Trigger save
		},
		async delete(key: string) {
			console.log(`[MOCK KV ${namespace}] DELETE ${key}`);
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

export const handle: Handle = async ({ event, resolve }) => {
	if (dev) {
		if (!event.platform) event.platform = { env: {} } as any;
		if (!event.platform.env) event.platform.env = {} as any;

		// Initialize KVs
		if (!event.platform.env.BETA_USERS_KV) event.platform.env.BETA_USERS_KV = createMockKV('USERS');
		if (!event.platform.env.BETA_LOGS_KV) event.platform.env.BETA_LOGS_KV = createMockKV('LOGS');
		if (!event.platform.env.BETA_LOGS_TRASH_KV) event.platform.env.BETA_LOGS_TRASH_KV = createMockKV('TRASH');
		if (!event.platform.env.BETA_USER_SETTINGS_KV) event.platform.env.BETA_USER_SETTINGS_KV = createMockKV('SETTINGS');
		
		if (!event.platform.env.BETA_HUGHESNET_KV) {
			event.platform.env.BETA_HUGHESNET_KV = createMockKV('HUGHESNET');
		}
		
		// Initialize PLACES KV
		if (!event.platform.env.BETA_PLACES_KV) {
			event.platform.env.BETA_PLACES_KV = createMockKV('PLACES');
		}
	}

	// Auth Logic
	const token = event.cookies.get('token');
	if (!token) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
		const usersKV = event.platform?.env?.BETA_USERS_KV;
		if (usersKV) {
			const userDataStr = await usersKV.get(token);
			if (userDataStr) {
				const userData = JSON.parse(userDataStr);
				event.locals.user = {
					id: userData.id,
					token,
					plan: userData.plan ?? 'free',
					tripsThisMonth: userData.tripsThisMonth ?? 0,
					maxTrips: userData.maxTrips ?? 10,
					resetDate: userData.resetDate ?? new Date().toISOString(),
					name: userData.name, 
					email: userData.email
				};
			} else {
				event.locals.user = null;
			}
		}
	} catch (err) {
		console.error('[HOOKS] KV Error:', err);
		event.locals.user = null;
	}

	return resolve(event);
};