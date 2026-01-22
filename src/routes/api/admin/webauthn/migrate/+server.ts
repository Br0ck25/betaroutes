import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { normalizeCredentialID, toBase64Url } from '$lib/server/webauthn-utils';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';

/**
 * [!code fix] Issue #48: Constant-time comparison for admin secret to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		// Still do comparison work to avoid timing leak on length mismatch
		const dummy = 'x'.repeat(Math.max(a.length, b.length));
		timingSafeEqualHelper(dummy, dummy);
		return false;
	}
	return timingSafeEqualHelper(a, b);
}

function timingSafeEqualHelper(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const bufA = enc.encode(a);
	const bufB = enc.encode(b);
	let result = 0;
	for (let i = 0; i < bufA.length; i++) {
		result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
	}
	return result === 0;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const { getEnv } = await import('$lib/server/env');
	const env = getEnv(platform);
	const secret = (env as any)?.ADMIN_MIGRATE_SECRET;

	if (!secret) {
		return json({ error: 'Migration disabled (no secret configured)' }, { status: 403 });
	}

	// [SECURITY FIX] Only accept admin secret via HTTP header, never via URL query parameter
	// URL parameters are logged in access logs, browser history, and referrer headers
	const provided = request.headers.get('x-admin-secret') || '';
	// [!code fix] Issue #48: Use constant-time comparison
	if (!timingSafeEqual(provided, secret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// List authenticator keys
		const kv = safeKV(env, 'BETA_USERS_KV') as KVNamespace | undefined;
		if (!kv || !kv.list) {
			return json(
				{ error: 'KV not available or unsupported in this environment' },
				{ status: 500 }
			);
		}

		const prefix = 'authenticators:';
		let cursor: string | undefined = undefined;
		let migrated = 0;
		let skipped = 0;
		const updatedUsers: string[] = [];

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
						updatedUsers.push(userId);
					}
				} catch (e) {
					log.warn('[webauthn migrate] error processing key', {
						key: item.name,
						message: (e as any)?.message
					});
				}
			}
		} while (cursor);

		return json({
			success: true,
			migrated,
			skipped,
			updatedUsersCount: updatedUsers.length,
			updatedUsers: updatedUsers.slice(0, 10) // Return first 10 for debugging
		});
	} catch (err) {
		log.error('[webauthn migrate] error', {
			message: err instanceof Error ? err.message : String(err)
		});
		// [!code fix] Issue #36: Don't expose error details to client
		return json(
			{
				error: 'Migration failed'
			},
			{ status: 500 }
		);
	}
};
