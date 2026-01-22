import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import { log } from '$lib/server/log';

// [!code fix] SECURITY: Use configured base URL to prevent host header injection
function getBaseUrl(urlOrigin: string): string {
	// In production, use the configured BASE_URL; in dev, allow url.origin
	const baseUrl = env['BASE_URL'] || env['SITE_URL'];
	if (baseUrl) return baseUrl;
	// Fallback to origin only in dev/test (when BASE_URL not set)
	return urlOrigin;
}

export async function POST({ locals, url }) {
	const user = locals.user as Record<string, unknown> | undefined;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const stripe = getStripe();
	const priceId = env['STRIPE_PRICE_ID_PRO'];

	if (!priceId) {
		log.error('Missing STRIPE_PRICE_ID_PRO env var');
		throw error(500, 'Configuration error');
	}

	const baseUrl = getBaseUrl(url.origin);

	try {
		const session = await stripe.checkout.sessions.create({
			mode: 'subscription',

			// Reverting to explicit types to fix "unknown parameter" error
			// 'card' includes Apple Pay and Google Pay automatically
			payment_method_types: ['card', 'link', 'cashapp'],

			line_items: [
				{
					price: priceId,
					quantity: 1
				}
			],
			// Pass user ID to webhook for fulfillment
			metadata: {
				userId: String(user['id'] ?? ''),
				username: String(user['username'] ?? '')
			},
			// Customer email pre-fill allows One-Click Link checkout
			customer_email: String(user['email'] ?? ''),
			success_url: `${baseUrl}/dashboard/settings?payment=success`,
			cancel_url: `${baseUrl}/dashboard/settings?payment=cancelled`
		});

		return json({ url: session.url });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('Stripe Checkout Error', { message });
		throw error(500, message || 'Failed to create checkout session');
	}
}
