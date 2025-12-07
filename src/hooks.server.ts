// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

// 🔥 GLOBAL STORAGE for local dev (persists across requests)
const globalUserStore = new Map();
const globalLogsStore = new Map();
const globalTrashStore = new Map();

function createMockKV(store: Map<any, any>) {
	return {
		async get(key: string) {
			return store.get(key) ?? null;
		},
		async put(key: string, value: string) {
			store.set(key, value);
		},
		async delete(key: string) {
			store.delete(key);
		},
		async list({ prefix }: { prefix: string }) {
			const keys = [...store.keys()]
				.filter((k) => typeof k === 'string' && k.startsWith(prefix))
				.map((name) => ({ name }));
			return { keys };
		}
	};
}

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Ensure KV bindings exist (mock in dev using GLOBAL stores)
	if (dev) {
		if (!event.platform) event.platform = { env: {} } as any;
		if (!event.platform.env) event.platform.env = {} as any;

		// Use the global maps so data persists!
		if (!event.platform.env.BETA_USERS_KV) {
			event.platform.env.BETA_USERS_KV = createMockKV(globalUserStore);
		}
		if (!event.platform.env.BETA_LOGS_KV) {
			event.platform.env.BETA_LOGS_KV = createMockKV(globalLogsStore);
		}
		if (!event.platform.env.BETA_LOGS_TRASH_KV) {
			event.platform.env.BETA_LOGS_TRASH_KV = createMockKV(globalTrashStore);
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
					token,
					plan: userData.plan ?? 'free',
					tripsThisMonth: userData.tripsThisMonth ?? 0,
					maxTrips: userData.maxTrips ?? 10,
					resetDate: userData.resetDate ?? new Date().toISOString(),
					// Add name/email if stored
					name: userData.name,
					email: userData.email
				};
			} else {
				// Fallback if token exists but no KV data
				event.locals.user = {
					token,
					plan: 'free',
					tripsThisMonth: 0,
					maxTrips: 10,
					resetDate: new Date().toISOString()
				};
			}
		}
	} catch (err) {
		console.error('[HOOK] KV Error:', err);
		// Fallback on error
		event.locals.user = {
			token,
			plan: 'free',
			tripsThisMonth: 0,
			maxTrips: 10,
			resetDate: new Date().toISOString()
		};
	}

	return resolve(event);
};
