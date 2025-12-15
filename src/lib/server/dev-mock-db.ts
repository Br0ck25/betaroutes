// src/lib/server/dev-mock-db.ts
import fs from 'node:fs';
import path from 'node:path';
// [!code ++] Import the key from SvelteKit's env module
import { PRIVATE_GOOGLE_MAPS_API_KEY } from '$env/static/private';

const DB_FILE = path.resolve('.kv-mock.json');

// Initial state
let mockDB: Record<string, any> = {
	USERS: {},
    SESSIONS: {}, // [!code fix] Ensure consistency with indentation
	LOGS: {},
	TRASH: {},
	SETTINGS: {},
	HUGHESNET: {},
	PLACES: {}
};

// Load existing data
try {
    if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const loaded = JSON.parse(raw);
        mockDB = { ...mockDB, ...loaded };
        
        // Ensure namespaces exist
        ['HUGHESNET', 'PLACES', 'SESSIONS'].forEach(ns => {
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

// Factory function
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

/**
 * Main Setup Function
 */
export function setupMockKV(event: any) {
    if (!event.platform) event.platform = { env: {} };
    if (!event.platform.env) event.platform.env = {};

    const env = event.platform.env;

    // [!code ++] Inject API Key for Dev (Required for Autocomplete)
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
}