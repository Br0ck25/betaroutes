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
	PLACES: {} // <--- ADDED
};

if (dev) {
	try {
		if (fs.existsSync(DB_FILE)) {
			const raw = fs.readFileSync(DB_FILE, 'utf-8');
			const loaded = JSON.parse(raw);
			
			// Merge loaded data with default structure
			mockDB = { ...mockDB, ...loaded };
			
			if (!mockDB.HUGHESNET) mockDB.HUGHESNET = {}; 
			if (!mockDB.PLACES) mockDB.PLACES = {}; // <--- ADDED
			
			console.log('📂 Loaded mock KV data from .kv-mock.json');
		}
	} catch (e) {
		console.error('Failed to load mock DB', e);
	}
}

function saveDB() {
	if (!dev) return;
	try {
		fs.writeFileSync(DB_FILE, JSON.stringify(mockDB, null, 2));
	} catch (e) {
		console.error('Failed to save mock DB', e);
	}
}

function createMockKV(namespace: string) {
	return {
		async get(key: string) {
			return mockDB[namespace][key] ?? null;
		},
		async put(key: string, value: string) {
			console.log(`[MOCK KV ${namespace}] PUT ${key}`);
			if (!mockDB[namespace]) mockDB[namespace] = {}; 
			
			mockDB[namespace][key] = value;
			saveDB(); 
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
	// 1. Ensure KV bindings exist (mock in dev using FILE store)
	if (dev) {
		if (!event.platform) event.platform = { env: {} } as any;
		if (!event.platform.env) event.platform.env = {} as any;

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

	// 2. User auth logic
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
				console.warn('[HOOK] Token exists but user not found in KV.');
				event.locals.user = null;
			}
		}
	} catch (err) {
		console.error('[HOOK] KV Error:', err);
		event.locals.user = null;
	}

	return resolve(event);
};