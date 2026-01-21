// src/hooks.server.ts
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { log } from '$lib/server/log';
// [!code ++] Import the user finder to check real-time status
import { findUserById } from '$lib/server/userService';
// [!code ++] SECURITY (Issue #4): CSRF protection
import { generateCsrfToken, csrfProtection } from '$lib/server/csrf';

export const handle: Handle = async ({ event, resolve }) => {
	// [!code ++] SECURITY (Issue #4): Generate CSRF token for all requests
	generateCsrfToken(event);

	// [!code ++] SECURITY (Issue #4): Validate CSRF token for state-changing API requests
	const csrfError = csrfProtection(event);
	if (csrfError) {
		return csrfError;
	}

	// 1. Ensure KV bindings exist (mock in dev/test using FILE store)
	// Also enable when tests manually start a preview server (PW_MANUAL_SERVER)
	if (dev || process.env['NODE_ENV'] !== 'production' || process.env['PW_MANUAL_SERVER'] === '1') {
		const { setupMockKV } = await import('$lib/server/dev-mock-db');
		setupMockKV(event);
	}

	// 2. User auth logic: Check for 'session_id' cookie
	const sessionId = event.cookies.get('session_id');

	// Regex for UUID v4 validation (Strict)
	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

	// Validate format before trusting the cookie to avoid wasting KV reads
	// If no cookie or invalid format, skip KV lookup entirely
	if (!sessionId || !UUID_REGEX.test(sessionId)) {
		event.locals.user = null;
		return resolve(event);
	}

	try {
		// [!code fix] Get both Session KV and Users KV via helper
		const { getEnv, safeKV } = await import('$lib/server/env');
		const env = getEnv(event.platform);
		const sessionKV = safeKV(env, 'BETA_SESSIONS_KV');
		const usersKV = safeKV(env, 'BETA_USERS_KV');

		if (sessionKV) {
			const sessionDataStr = await sessionKV.get(sessionId);
			log.info('[HOOK] session lookup', { sessionId, found: !!sessionDataStr });

			if (sessionDataStr) {
				const session = JSON.parse(sessionDataStr);

				// [!code ++] FETCH FRESH USER DATA
				// Assume session is stale; check the main DB for the absolute latest plan
				let freshPlan: 'free' | 'premium' = (session.plan ?? 'free') as 'free' | 'premium';
				let freshStripeId = session.stripeCustomerId;
				let freshMaxTrips = session.maxTrips ?? 10;

				if (usersKV && session.id) {
					try {
						const freshUser = await findUserById(usersKV, session.id);
						if (freshUser) {
							freshPlan = freshUser.plan as 'free' | 'premium';
							freshStripeId = freshUser.stripeCustomerId;
							// Only update maxTrips if the user record has it, otherwise keep session's
							if (freshUser.maxTrips) freshMaxTrips = freshUser.maxTrips;
						}
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						log.error('[HOOK] Failed to fetch fresh user data:', { message: msg });
					}
				}
				event.locals.user = {
					id: session.id,
					token: sessionId,
					// [!code fix] Use the FRESH values from DB
					plan: freshPlan,
					tripsThisMonth: session.tripsThisMonth ?? 0,
					maxTrips: freshMaxTrips,
					resetDate: session.resetDate ?? new Date().toISOString(),
					name: session.name,
					email: session.email,
					stripeCustomerId: freshStripeId // [!code ++] Required for Portal
				} as {
					id?: string;
					token: string;
					plan: 'free' | 'premium';
					tripsThisMonth: number;
					maxTrips: number;
					resetDate: string;
					name?: string;
					email?: string;
					stripeCustomerId?: string | undefined;
				};
			} else {
				// Session ID cookie exists, but data is gone from KV (expired/deleted)
				if (event.url.pathname.startsWith('/dashboard')) {
					log.warn('[HOOK] Session expired or invalid.');
				}
				event.locals.user = null;
			}
		}
	} catch (err) {
		log.error('[HOOK] KV Error:', err);
		event.locals.user = null;
	}

	// Ensure static assets have efficient cache lifetimes to improve repeat-visit performance.
	// - Hashed app assets (/ _app/ or files containing long hex hashes) => 1 year, immutable
	// - Other static assets (images, fonts, scripts, styles, media) => 30 days
	// Do NOT override existing Cache-Control headers, and skip HTML/API responses.
	const response = await resolve(event);

	// [!code ++] SECURITY HEADERS (Issue #6, #48)
	// Add security headers to all responses
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');

	// Content Security Policy (Issue #6)
	if (!response.headers.has('Content-Security-Policy')) {
		response.headers.set(
			'Content-Security-Policy',
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"img-src 'self' data: https: blob:",
				"font-src 'self' https://fonts.gstatic.com",
				"connect-src 'self' https://maps.googleapis.com https://places.googleapis.com",
				"frame-src 'none'",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'"
			].join('; ')
		);
	}

	try {
		if (event.request.method === 'GET' && response.status === 200) {
			const existing = response.headers.get('cache-control');
			if (!existing) {
				const urlPath = event.url.pathname.toLowerCase();
				const oneYear = 'public, max-age=31536000, immutable';
				const thirtyDays = 'public, max-age=2592000, immutable';

				const isHtml = urlPath.endsWith('/') || urlPath.endsWith('.html') || urlPath === '/';
				if (!isHtml) {
					const isHashedAsset = urlPath.startsWith('/_app/') || /\.[a-f0-9]{8,}\./.test(urlPath);
					if (isHashedAsset) {
						response.headers.set('Cache-Control', oneYear);
					} else if (
						/(?:\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|ogg|mp3|wav|css|js|mjs|woff2?|ttf|otf|eot))$/.test(
							urlPath
						)
					) {
						response.headers.set('Cache-Control', thirtyDays);
					}
				}
			}
		}
	} catch (e) {
		// Do not interrupt request flow for header-setting errors
		log.warn('[HOOK] cache header set failed', e);
	}

	return response;
};
