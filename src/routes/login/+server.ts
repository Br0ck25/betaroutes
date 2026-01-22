// src/routes/login/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser } from '$lib/server/auth';
import { getEnv, safeKV, safeDO } from '$lib/server/env';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { makeTripService } from '$lib/server/tripService';
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

		// 3a. Email-based rate limiting (prevents distributed attacks targeting single account)
		// [!code fix] SECURITY: Rate limit by email in addition to IP
		if (kv && email) {
			const emailHash = email
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9@.]/g, '');
			const emailLimitResult = await checkRateLimit(kv, emailHash, 'login_email', 10, 900); // 10 attempts per 15 minutes per email
			if (!emailLimitResult.allowed) {
				return json(
					{
						error:
							'This account is temporarily locked due to too many failed attempts. Please try again later.'
					},
					{ status: 429 }
				);
			}
		}

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

		// 9. AUTO-MIGRATION
		// Move legacy data (username key) to new storage (UUID key) in background
		if (
			platform?.context &&
			safeKV(env, 'BETA_LOGS_KV') &&
			(safeDO(env, 'TRIP_INDEX_DO') || (env as unknown as Record<string, unknown>)['TRIP_INDEX_DO'])
		) {
			const userId = authResult.id;
			const username = authResult.username;

			platform.context.waitUntil(
				(async () => {
					try {
						const tripIndexDO =
							safeDO(env, 'TRIP_INDEX_DO') ||
							(env as unknown as Record<string, unknown>)['TRIP_INDEX_DO'];
						const placesIndexDO = safeDO(env, 'PLACES_INDEX_DO') || tripIndexDO;
						const svc = makeTripService(
							safeKV(env, 'BETA_LOGS_KV') as any,
							undefined,
							safeKV(env, 'BETA_PLACES_KV') as any,
							tripIndexDO as any,
							placesIndexDO as any
						);

						// Trigger the move. If keys exist under 'username', they move to 'userId'.
						await (svc as any).migrateUser?.(username, userId);
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						log.error('[Auto-Migration] Failed', { username, message: msg });
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
