import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserAuthenticators } from '$lib/server/authenticatorService';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

export const GET: RequestHandler = async ({ platform, locals, cookies }) => {
	try {
		// Check if user is authenticated
		const user = locals.user as { id?: string; email?: string; name?: string } | undefined;
		if (!user?.id) {
			// Log cookie value to help debug session mismatches in production
			try {
				const cookieVal = cookies.get('session_id');
				log.debug('[WebAuthn List] Unauthorized request; session_id cookie', {
					present: !!cookieVal
				});
			} catch {
				// ignore - no binding needed
			}
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const env = getEnv(platform);
		const usersKV = safeKV(env, 'BETA_USERS_KV');
		if (!usersKV) {
			return json({ error: 'Service unavailable' }, { status: 503 });
		}

		// Get user's authenticators
		const authenticators = await getUserAuthenticators(usersKV, user.id);

		// Return sanitized list (don't expose the public key)
		const sanitized = authenticators.map((auth) => ({
			credentialID: auth.credentialID,
			transports: auth.transports || [],
			name: auth.name || null,
			createdAt: auth.createdAt || null
		}));

		return json({
			success: true,
			authenticators: sanitized
		});
	} catch (error) {
		log.error('[WebAuthn List] Error', { message: createSafeErrorMessage(error) });
		return json(
			{
				error: 'Failed to retrieve passkeys'
			},
			{ status: 500 }
		);
	}
};
