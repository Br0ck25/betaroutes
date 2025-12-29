import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform }) => {
	// Dev/test helper: seed an entry into SESSIONS_KV
	try {
		// Accept both JSON and form-encoded bodies (Playwright Request may send form data)
		let body: { sessionId?: string; user?: Record<string, unknown> } | null = null;
		log.info('[DEBUG] NODE_ENV', process.env['NODE_ENV']);
		try {
			body = (await request.json()) as { sessionId?: string; user?: Record<string, unknown> };
		} catch (_e: unknown) {
			void _e;
			// Fallback: try to parse text as JSON
			try {
				const txt = await request.text();
				if (txt) body = JSON.parse(txt);
			} catch (_e2: unknown) {
				void _e2;
				// Fallback: try formData
				try {
					const fd = await request.formData();
					const obj: Record<string, any> = {};
					for (const [k, v] of fd.entries()) obj[k] = v;
					if (typeof obj['user'] === 'string') {
						try {
							obj['user'] = JSON.parse(obj['user'] as string);
						} catch (_parse: unknown) {
							void _parse;
						}
					}
					body = obj as any;
				} catch (_e3: unknown) {
					void _e3;
					// give up
					body = null;
				}
			}
		}

		if (!body?.sessionId || !body?.user)
			return json({ error: 'Missing sessionId or user' }, { status: 400 });

		// As a convenience for tests, seed the in-memory mock DB directly
		try {
			const { seedMockSession } = await import('$lib/server/dev-mock-db');
			await seedMockSession(body.sessionId!, body.user!);
			log.info('[DEBUG] Seeded mock session via unconditional fallback');
			return json({ success: true });
		} catch (e) {
			log.warn('[DEBUG] seedMockSession failed', String(e));
		}

		const { getEnv, safeKV } = await import('$lib/server/env');
		let env = getEnv(platform);
		log.info('[DEBUG] seed-session env keys', Object.keys(env || {}));
		let sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');

		// If missing, attempt to initialize the file-backed mock (non-production only)
		if (!sessionsKV && process.env['NODE_ENV'] !== 'production') {
			// Try attaching mock env to a fake event
			const { setupMockKV, seedMockSession } = await import('$lib/server/dev-mock-db');
			const fakeEvent: any = { platform: { env: {} } };
			setupMockKV(fakeEvent);
			log.info('[DEBUG] fakeEvent env keys', Object.keys(fakeEvent.platform.env || {}));
			env = getEnv(fakeEvent.platform);
			sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');

			// As a last resort, directly seed the in-memory mock DB so tests can proceed
			if (!sessionsKV) {
				await seedMockSession(body.sessionId, body.user);
				log.info('[DEBUG] Seeded mock session via seedMockSession');
				return json({ success: true });
			}
		}

		if (!sessionsKV)
			return json(
				{ error: 'Sessions KV missing', envKeys: Object.keys(env || {}) },
				{ status: 500 }
			);

		await sessionsKV.put(body.sessionId, JSON.stringify(body.user));
		log.info(`[DEBUG] Seeded session ${body.sessionId}`);
		return json({ success: true });
	} catch (err: unknown) {
		const { createSafeErrorMessage } = await import('$lib/server/sanitize');
		log.warn('[DEBUG] Failed to seed session', { message: createSafeErrorMessage(err) });
		return json({ error: createSafeErrorMessage(err) }, { status: 500 });
	}
};
