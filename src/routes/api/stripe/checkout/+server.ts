import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import { log } from '$lib/server/log';

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
      success_url: `${url.origin}/dashboard/settings?payment=success`,
      cancel_url: `${url.origin}/dashboard/settings?payment=cancelled`
    });

    return json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Stripe Checkout Error', { message });
    throw error(500, message || 'Failed to create checkout session');
  }
}
