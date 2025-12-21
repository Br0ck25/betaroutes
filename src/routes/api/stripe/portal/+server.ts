// src/routes/api/stripe/portal/+server.ts
import { json, error } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { findUserById } from '$lib/server/userService';

export async function POST({ locals, url, platform }) {
    const currentUser = locals.user;
    
    if (!currentUser?.id) {
        throw error(401, 'Unauthorized');
    }

    if (!platform?.env?.BETA_USERS_KV) {
        throw error(500, 'Service unavailable');
    }

    try {
        // Fetch full user record to get Stripe Customer ID
        const user = await findUserById(platform.env.BETA_USERS_KV, currentUser.id);
        
        if (!user?.stripeCustomerId) {
            throw error(400, 'No billing account found. Please upgrade first.');
        }

        const stripe = getStripe();
        const session = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: `${url.origin}/dashboard/settings?portal=success`,
        });

        return json({ url: session.url });
    } catch (err: any) {
        console.error('Stripe Portal Error:', err);
        if (err.status) throw err; // Re-throw SvelteKit errors
        throw error(500, 'Failed to create portal session');
    }
}