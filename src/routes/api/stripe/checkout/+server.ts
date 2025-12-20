import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';

export async function POST({ locals, url }) {
    const user = locals.user;
    if (!user) {
        throw error(401, 'Unauthorized');
    }

    const stripe = getStripe();
    const priceId = env.STRIPE_PRICE_ID_PRO;

    if (!priceId) {
        console.error('Missing STRIPE_PRICE_ID_PRO env var');
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
                    quantity: 1,
                },
            ],
            // Pass user ID to webhook for fulfillment
            metadata: {
                userId: user.id,
                username: user.username
            },
            // Customer email pre-fill allows One-Click Link checkout
            customer_email: user.email,
            success_url: `${url.origin}/dashboard/settings?payment=success`,
            cancel_url: `${url.origin}/dashboard/settings?payment=cancelled`,
        });

        return json({ url: session.url });
    } catch (err: any) {
        console.error('Stripe Checkout Error:', err);
        throw error(500, err.message || 'Failed to create checkout session');
    }
}