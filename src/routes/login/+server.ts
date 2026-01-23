// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { getEnv, safeKV } from '$lib/server/env';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { checkRateLimit } from '$lib/server/rateLimit';
import { migrateUserStorageKeys } from '$lib/server/migration/storage-key-migration';
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
			if (!dev) return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		// 2. Rate Limiting (Prevent Credential Stuffing)
		// [!code fix] Issue #50: Use higher limit in dev instead of completely disabling
		if (kv) {
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

		// 3. Parse Body
		const body = (await request.json()) as { email?: string; password?: string };
		const { email, password } = body;

		// 4. Authenticate
		// @ts-expect-error - authenticateUser has broader types; casting result safely below
		const authResult = await authenticateUser(kv, email, password);

		if (!authResult) {
			return json({ error: 'Invalid credentials' }, { status: 401 });
		}

		// 5. Fetch Full User details
		const fullUser = await findUserById(
			kv as unknown as import('@cloudflare/workers-types').KVNamespace,
			authResult.id
		);
		const now = new Date().toISOString();

		// 6. Prepare Session Data
		const sessionData = {
			id: authResult.id,
			// [!code fix] Use the display name (e.g. "James") if available, otherwise fallback to username
			name: fullUser?.name || authResult.username,
			email: authResult.email,
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
		// @ts-expect-error - createSession signature is broad in some environments
		const sessionId = await createSession(sessionKv, sessionData);

		// 8. Set Cookie (Issue #5: Changed sameSite from 'none' to 'lax' for better security)
		cookies.set('session_id', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax', // [!code fix] Changed from 'none' for CSRF protection
			secure: true,
			maxAge: 60 * 60 * 24 * 7
		});

		// 9. PHASE 2: AUTO-MIGRATION
		// Migrate all user data from username-based keys to user ID-based keys
		// This fixes the P0 account takeover vulnerability (STORAGE_KEY_MIGRATION.md)
		// Runs in background using waitUntil (non-blocking)
		if (platform?.context && authResult.username) {
			const userId = authResult.id;
			const username = authResult.username;

			platform.context.waitUntil(
				(async () => {
					try {
						log.info('[MIGRATION] Starting background storage key migration', {
							userId,
							username
						});

						// Run comprehensive migration for all data types
						const result = await migrateUserStorageKeys(
							{
								BETA_LOGS_KV: safeKV(env, 'BETA_LOGS_KV') as KVNamespace | undefined,
								BETA_EXPENSES_KV: safeKV(env, 'BETA_EXPENSES_KV') as KVNamespace | undefined,
								BETA_MILLAGE_KV: safeKV(env, 'BETA_MILLAGE_KV') as KVNamespace | undefined,
								BETA_TRASH_KV: safeKV(env, 'BETA_TRASH_KV') as KVNamespace | undefined,
								BETA_HUGHESNET_KV: safeKV(env, 'BETA_HUGHESNET_KV') as KVNamespace | undefined,
								BETA_HUGHESNET_ORDERS_KV: safeKV(env, 'BETA_HUGHESNET_ORDERS_KV') as
									| KVNamespace
									| undefined
							},
							userId,
							username
						);

						if (result.success) {
							log.info('[MIGRATION] Background migration completed successfully', {
								userId,
								username,
								recordsMigrated: result.migrated
							});

							// Update user record with migration status
							if (kv) {
								try {
									const userKey = `user:${userId}`;
									const userRaw = await kv.get(userKey);
									if (userRaw) {
										const user = JSON.parse(userRaw);
										user.migrationStatus = {
											storageKeysMigrated: true,
											migratedAt: new Date().toISOString(),
											recordsMigrated: result.migrated
										};
										await kv.put(userKey, JSON.stringify(user));
										log.info('[MIGRATION] Updated user record with migration status', {
											userId
										});
									}
								} catch (statusErr) {
									log.error('[MIGRATION] Failed to update user migration status', {
										userId,
										error: statusErr instanceof Error ? statusErr.message : String(statusErr)
									});
								}
							}
						} else {
							log.error('[MIGRATION] Background migration completed with errors', {
								userId,
								username,
								recordsMigrated: result.migrated,
								errors: result.errors
							});
						}
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						log.error('[MIGRATION] Background migration threw exception', {
							userId,
							username,
							error: msg
						});
					}
				})()
			);
		}

		return json({ user: sessionData });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('Login error', { message: msg });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
