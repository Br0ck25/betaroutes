import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findUserByEmail } from '$lib/server/userService';
import { safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { createSafeErrorMessage } from '$lib/server/sanitize';

export const GET: RequestHandler = async ({ url, platform }) => {
	try {
		const email = url.searchParams.get('email');
		if (!email) return json({ error: 'Email required' }, { status: 400 });

		const env = platform?.env;
		if (!safeKV(env, 'BETA_USERS_KV'))
			return json({ error: 'Service unavailable' }, { status: 503 });

		const user = await findUserByEmail(safeKV(env, 'BETA_USERS_KV')!, email);
		if (!user) return json({ success: true, authenticators: [] });

		const authenticators = user.authenticators || [];
		const sanitized = authenticators.map((a) => ({
			credentialID: a.credentialID,
			name: a.name || null,
			transports: a.transports || [],
			createdAt: a.createdAt || null
		}));

		return json({ success: true, authenticators: sanitized });
	} catch (err) {
		log.error('[WebAuthn list-for-email] Error', { message: createSafeErrorMessage(err) });
		return json({ error: 'Failed to lookup authenticators' }, { status: 500 });
	}
};
