// src/routes/api/stripe/portal/+server.ts
import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';

export async function POST({ locals, url }) {
    const user = locals.user;
    if (!user) throw error(401, 'Unauthorized');

    // We must have a stripeCustomerId to open the portal
    if (!user.stripeCustomerId) {
        // If they are 'pro' but missing ID, it's an edge case (manual upgrade?)
        throw error(400, 'No billing account found. Please contact support.');
    }

    const stripe = getStripe();

    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: `${url.origin}/dashboard/settings`,
        });

        return json({ url: session.url });
    } catch (err: any) {
        console.error('Stripe Portal Error:', err);
        throw error(500, 'Failed to create portal session');
    }
}