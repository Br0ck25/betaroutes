// src/routes/api/stripe/portal/+server.ts
import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { findUserById } from '$lib/server/userService';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { env as privateEnv } from '$env/dynamic/private';

// [!code fix] SECURITY: Use configured base URL to prevent host header injection
function getBaseUrl(urlOrigin: string): string {
	const baseUrl = privateEnv['BASE_URL'] || privateEnv['SITE_URL'];
	if (baseUrl) return baseUrl;
	return urlOrigin;
}

export async function POST({ locals, url, platform }) {
	const currentUser = locals.user as Record<string, unknown> | undefined;
	const userId =
		typeof currentUser?.['id'] === 'string' ? (currentUser['id'] as string) : undefined;

	if (!userId) {
		throw error(401, 'Unauthorized');
	}

	const env = getEnv(platform);
	const usersKV = safeKV(env, 'BETA_USERS_KV');
	if (!usersKV) {
		throw error(500, 'Service unavailable');
	}

	const baseUrl = getBaseUrl(url.origin);

	try {
		// Fetch full user record to get Stripe Customer ID
		const user = await findUserById(usersKV, userId);

		if (!user?.stripeCustomerId) {
			throw error(400, 'No billing account found. Please upgrade first.');
		}

		const stripe = getStripe();
		const session = await stripe.billingPortal.sessions.create({
			customer: user.stripeCustomerId,
			return_url: `${baseUrl}/dashboard/settings?portal=success`
		});

		return json({ url: session.url });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('Stripe Portal Error', { message });
		if (typeof (err as { status?: unknown })?.status === 'number') throw err; // Re-throw SvelteKit errors
		throw error(500, 'Failed to create portal session');
	}
}
