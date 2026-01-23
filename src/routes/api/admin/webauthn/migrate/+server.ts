import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { normalizeCredentialID, toBase64Url } from '$lib/server/webauthn-utils';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { logAdminAction } from '$lib/server/auditLog';
import { safeCompare } from '$lib/server/csrf';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const { getEnv } = await import('$lib/server/env');
	const env = getEnv(platform);
	const secret = (env as any)?.ADMIN_MIGRATE_SECRET;
	const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
	const auditKV = safeKV(env, 'BETA_USERS_KV');

	if (!secret) {
		await logAdminAction(
			auditKV,
			'webauthn_migrate',
			{ reason: 'no_secret_configured' },
			false,
			clientIp
		);
		return json({ error: 'Migration disabled (no secret configured)' }, { status: 403 });
	}

	// [SECURITY FIX] Only accept admin secret via HTTP header, never via URL query parameter
	// URL parameters are logged in access logs, browser history, and referrer headers
	// [SECURITY FIX] Use timing-safe comparison to prevent timing attacks
	const provided = request.headers.get('x-admin-secret') || '';
	if (!safeCompare(provided, secret)) {
		await logAdminAction(auditKV, 'webauthn_migrate', { reason: 'unauthorized' }, false, clientIp);
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// List authenticator keys
		const kv = safeKV(env, 'BETA_USERS_KV') as KVNamespace | undefined;
		if (!kv || !kv.list) {
			await logAdminAction(
				auditKV,
				'webauthn_migrate',
				{ reason: 'kv_unavailable' },
				false,
				clientIp
			);
			return json(
				{ error: 'KV not available or unsupported in this environment' },
				{ status: 500 }
			);
		}

		const prefix = 'authenticators:';
		let cursor: string | undefined = undefined;
		let migrated = 0;
		let skipped = 0;
		// [SECURITY FIX] Use counter instead of array to prevent OOM on large user bases
		let updatedUsersCount = 0;
		// Only keep a small sample for debugging (circular buffer behavior)
		const SAMPLE_SIZE = 10;
		const sampleUsers: string[] = [];

		do {
			const res = (await kv.list({ prefix, cursor, limit: 100 })) as any;
			cursor = res?.cursor;

			for (const item of res.keys) {
				try {
					const key = item.name; // authenticators:{userId}
					const userId = key.replace(prefix, '');
					const data = (await kv.get(key, 'json')) as any[] | null;

					if (!Array.isArray(data)) continue;

					let modified = false;
					for (let i = 0; i < data.length; i++) {
						const auth = data[i];
						if (!auth || !auth.credentialID) continue;

						if (typeof auth.credentialID !== 'string') {
							// Try to normalize
							try {
								const normalized = normalizeCredentialID(auth.credentialID);
								if (normalized) {
									auth.credentialID = normalized;
									modified = true;
									migrated++;

									// Normalize public key if present
									if (auth.credentialPublicKey && typeof auth.credentialPublicKey !== 'string') {
										try {
											auth.credentialPublicKey = toBase64Url(auth.credentialPublicKey);
										} catch (e) {
											log.warn('[webauthn migrate] failed to normalize public key for user', {
												userId,
												message: (e as any)?.message
											});
										}
									}

									// Update credential index - FIXED: proper function call syntax
									try {
										await kv.put(`credential:${auth.credentialID}`, userId);
									} catch (e) {
										log.warn('[webauthn migrate] failed to write credential index', {
											credentialID: auth.credentialID,
											message: (e as any)?.message
										});
									}
								} else {
									skipped++;
								}
							} catch (e) {
								log.warn('[webauthn migrate] failed to normalize credential for user', {
									userId,
									message: (e as any)?.message
								});
								skipped++;
							}
						}
					}

					if (modified) {
						await kv.put(key, JSON.stringify(data));
						updatedUsersCount++;
						// Keep only a sample for debugging (don't grow unbounded)
						if (sampleUsers.length < SAMPLE_SIZE) {
							sampleUsers.push(userId);
						}
					}
				} catch (e) {
					log.warn('[webauthn migrate] error processing key', {
						key: item.name,
						message: (e as any)?.message
					});
				}
			}
		} while (cursor);

		// [AUDIT] Log successful migration
		await logAdminAction(
			auditKV,
			'webauthn_migrate',
			{
				migrated,
				skipped,
				updatedUsersCount
			},
			true,
			clientIp
		);

		return json({
			success: true,
			migrated,
			skipped,
			updatedUsersCount,
			sampleUsers // First 10 for debugging (fixed size, no OOM risk)
		});
	} catch (err) {
		// [AUDIT] Log failed migration
		await logAdminAction(
			auditKV,
			'webauthn_migrate',
			{
				error: err instanceof Error ? err.message : String(err)
			},
			false,
			clientIp
		);

		log.error('[webauthn migrate] error', {
			message: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
		return json(
			{
				error: 'Migration failed',
				details: err instanceof Error ? err.message : String(err)
			},
			{ status: 500 }
		);
	}
};
