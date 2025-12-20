// src/routes/api/stripe/webhook/+server.ts
import { json } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { updateUserPlan } from '$lib/server/userService';
import { env } from '$env/dynamic/private';

export async function POST({ request, platform }) {
    const sig = request.headers.get('stripe-signature');
    const body = await request.text();
    const stripe = getStripe();
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
        return json({ error: 'Missing signature or config' }, { status: 400 });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`);
        return json({ error: 'Webhook Error' }, { status: 400 });
    }

    // Handle specific event types
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        const userId = session.metadata?.userId;
        const customerId = session.customer as string; // [!code ++] Extract Customer ID

        if (userId && platform?.env?.BETA_USERS_KV) {
            console.log(`💰 Payment success for user ${userId}. Customer: ${customerId}`);
            
            try {
                // [!code ++] Pass customerId to update function
                // Note: Ensure you are using the correct KV binding name from your Wrangler.toml
                // Based on previous files, it seems to be BETA_USERS_KV
                await updateUserPlan(platform.env.BETA_USERS_KV, userId, 'pro', customerId);
                console.log(`✅ User ${userId} upgraded successfully.`);
            } catch (e) {
                console.error('Failed to upgrade user plan:', e);
                return json({ error: 'Upgrade failed' }, { status: 500 });
            }
        } else {
             console.error('Missing userId or KV binding in webhook');
        }
    }

    return json({ received: true });
}