// src/routes/api/stripe/webhook/+server.ts
import { json } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { updateUserPlan } from '$lib/server/userService';

export async function POST({ request, platform }) {
    console.log('🔔 Webhook received');
    
    const sig = request.headers.get('stripe-signature');
    const body = await request.text();
    const stripe = getStripe();
    
    const webhookSecret = platform?.env?.STRIPE_WEBHOOK_SECRET;
    
    console.log('🔍 Platform env exists?', !!platform?.env);
    console.log('🔍 Webhook secret exists?', !!webhookSecret);
    console.log('🔍 Signature exists?', !!sig);
    
    if (!sig) {
        console.error('❌ No signature header');
        return json({ error: 'Missing signature' }, { status: 400 });
    }
    
    if (!webhookSecret) {
        console.error('❌ No webhook secret in environment');
        return json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    let event;
    try {
        event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
        console.log('✅ Webhook verified:', event.type);
    } catch (err: any) {
        console.error(`❌ Signature verification failed: ${err.message}`);
        return json({ error: 'Webhook Error' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as any;
                const userId = session.metadata?.userId;
                const customerId = session.customer as string;
                
                console.log(`💰 Payment success for user ${userId}, customer ${customerId}`);
                
                if (userId && platform?.env?.BETA_USERS_KV) {
                    await updateUserPlan(
                        platform.env.BETA_USERS_KV, 
                        userId, 
                        'pro', 
                        customerId
                    );
                    console.log(`✅ User ${userId} upgraded to Pro`);
                } else {
                    console.error('❌ Missing userId or KV binding');
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as any;
                const customerId = subscription.customer;
                
                console.log(`🔻 Subscription cancelled for customer ${customerId}`);
                
                if (platform?.env?.BETA_USERS_KV) {
                    await downgradeUserByCustomerId(platform.env.BETA_USERS_KV, customerId);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object as any;
                const customerId = subscription.customer;
                const status = subscription.status;
                
                console.log(`📝 Subscription updated for ${customerId}: ${status}`);
                
                // Downgrade if subscription becomes inactive
                if (['canceled', 'unpaid', 'past_due'].includes(status)) {
                    if (platform?.env?.BETA_USERS_KV) {
                        await downgradeUserByCustomerId(platform.env.BETA_USERS_KV, customerId);
                    }
                }
                break;
            }

            default:
                console.log(`ℹ️ Unhandled event: ${event.type}`);
        }

        return json({ received: true });

    } catch (err) {
        console.error('❌ Webhook processing error:', err);
        return json({ error: 'Processing failed' }, { status: 500 });
    }
}

/**
 * Find user by Stripe customer ID and downgrade to free plan
 */
async function downgradeUserByCustomerId(kv: any, stripeCustomerId: string) {
    try {
        // Search through all user records to find matching stripeCustomerId
        const prefix = 'user:';
        let cursor: string | undefined = undefined;
        
        do {
            const list = await kv.list({ prefix, cursor });
            
            for (const key of list.keys) {
                const raw = await kv.get(key.name);
                if (raw) {
                    const user = JSON.parse(raw);
                    if (user.stripeCustomerId === stripeCustomerId) {
                        // Found the user - downgrade them
                        await updateUserPlan(kv, user.id, 'free');
                        console.log(`✅ Downgraded user ${user.id} (${user.email}) to free plan`);
                        return;
                    }
                }
            }
            
            cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        
        console.warn(`⚠️ No user found with stripeCustomerId: ${stripeCustomerId}`);
    } catch (err) {
        console.error('❌ Error downgrading user:', err);
        throw err;
    }
}