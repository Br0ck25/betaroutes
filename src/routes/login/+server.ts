// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { createSession } from '$lib/server/sessionService';
import { migrateUserStorageKeys } from '$lib/server/migration/storage-key-migration';
import { findUserById } from '$lib/server/userService';
import { checkRateLimit } from '$lib/server/rateLimit';
import { dev } from '$app/environment';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, cookies, getClientAddress }) => {
	try {
		const env = getEnv(platform);
		const kv = safeKV(env, 'BETA_USERS_KV');
		const sessionKv = safeKV(env, 'BETA_SESSIONS_KV');

		// 1. Check Bindings
		if (!kv || !sessionKv) {
			log.error('KV binding missing');
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		// 2. Rate Limiting (Prevent Credential Stuffing)
		// [!code fix] Issue #50: Use higher limit in dev instead of completely disabling
		{
			const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();

			// Dev mode: 50 attempts per 60s (more lenient but still protected)
			// Prod mode: 5 attempts per 60s
			const limit = dev ? 50 : 5;
			const limitResult = await checkRateLimit(kv, clientIp, 'login_attempt', limit, 60);

			if (!limitResult.allowed) {
				return json(
					{
						error: `Too many login attempts. Please try again in a minute.${dev ? ' (Dev mode: limit 50/min)' : ''}`
					},
					{ status: 429 }
				);
			}
		}

		// 3. Parse Body (strict validation)
		const rawBody = await request.json().catch(() => null);
		if (!rawBody || typeof rawBody !== 'object') {
			return json({ error: 'Invalid request' }, { status: 400 });
		}
		const parsed = rawBody as Record<string, unknown>;
		const email = typeof parsed['email'] === 'string' ? parsed['email'].trim() : '';
		const password = typeof parsed['password'] === 'string' ? parsed['password'] : '';
		if (!email || !password) {
			return json({ error: 'Email and password are required' }, { status: 400 });
		}

		// 4. Authenticate (pass ExecutionContext for optional background tasks)
		const execContext = platform?.context as unknown as ExecutionContext | undefined;
		const authResult = await authenticateUser(kv, email, password, execContext);

		if (!authResult) {
			return json({ error: 'Invalid credentials' }, { status: 401 });
		}

		// 5. Fetch Full User details
		const fullUser = await findUserById(kv as unknown as KVNamespace, authResult.id);
		const now = new Date().toISOString();

		// 6. Prepare Session Data (Do NOT rely on authResult for sensitive fields)
		const sessionData = {
			id: authResult.id,
			name: fullUser?.name ?? fullUser?.username ?? '',
			email: fullUser?.email ?? '',
			plan: fullUser?.plan || 'free',
			tripsThisMonth: fullUser?.tripsThisMonth || 0,
			maxTrips: fullUser?.maxTrips || 10,
			resetDate: fullUser?.resetDate || now,
			role:
				fullUser && typeof (fullUser as { role?: string }).role === 'string'
					? (fullUser as { role?: string }).role
					: 'user'
		};

		// 7. Create Session in SESSIONS_KV
		const sessionId = await createSession(sessionKv, sessionData);

		// 8. Set Cookie (Issue #5: Changed sameSite from 'none' to 'lax' for better security)
		cookies.set('session_id', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax', // [!code fix] Changed from 'none' for CSRF protection
			secure: true,
			maxAge: 60 * 60 * 24 * 7
		});

		// 9. AUTO-MIGRATION - run in background (typed, uses migration util)
		if (platform?.context) {
			const logsKV = safeKV(env, 'BETA_LOGS_KV');
			const tripIndexDO = safeDO(env, 'TRIP_INDEX_DO');
			if (logsKV && tripIndexDO) {
				const userId = authResult.id;
				const username = fullUser?.username ?? '';
				if (username) {
					const migrationEnv = {
						BETA_LOGS_KV: logsKV,
						BETA_EXPENSES_KV: safeKV(env, 'BETA_EXPENSES_KV'),
						BETA_MILEAGE_KV: safeKV(env, 'BETA_MILEAGE_KV'),
						BETA_TRASH_KV: safeKV(env, 'BETA_TRASH_KV'),
						BETA_HUGHESNET_KV: safeKV(env, 'BETA_HUGHESNET_KV'),
						BETA_HUGHESNET_ORDERS_KV: safeKV(env, 'BETA_HUGHESNET_ORDERS_KV')
					};
					platform.context.waitUntil(
						migrateUserStorageKeys(migrationEnv, userId, username).catch((e: unknown) => {
							const msg = e instanceof Error ? e.message : String(e);
							log.error('[Auto-Migration] Failed', { username, message: msg });
						})
					);
				}
			}
		}

		return json({ user: sessionData });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('Login error', { message: msg });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
