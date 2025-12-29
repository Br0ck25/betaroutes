// src/routes/api/stripe/webhook/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getStripe } from '$lib/server/stripe';
import { updateUserPlan } from '$lib/server/userService';
import { safeKV } from '$lib/server/env';
import { createSafeErrorMessage } from '$lib/server/sanitize';
import { log } from '$lib/server/log';
import type { KVNamespace } from '@cloudflare/workers-types';
import type Stripe from 'stripe';

export const POST: RequestHandler = async ({ request, platform }) => {
	log.info('Stripe webhook received');

	const sig = request.headers.get('stripe-signature');
	const body = await request.text();
	const stripe = getStripe();
	const env = platform?.env as Record<string, unknown> | undefined;

	const webhookSecret = (env as Record<string, unknown>)['STRIPE_WEBHOOK_SECRET'] as
		| string
		| undefined;

	if (!sig) {
		log.error('Stripe webhook missing signature header');
		return json({ error: 'Missing signature' }, { status: 400 });
	}

	if (!webhookSecret) {
		log.error('Stripe webhook secret not configured');
		return json({ error: 'Webhook secret not configured' }, { status: 500 });
	}

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, sig as string, webhookSecret as string);
		log.info('✅ Webhook verified', { eventType: event.type });
	} catch (err: unknown) {
		log.error('❌ Signature verification failed', { message: createSafeErrorMessage(err) });
		return json({ error: 'Webhook Error' }, { status: 400 });
	}

	try {
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as unknown as Record<string, unknown> | undefined;
				const metadata =
					session && typeof session['metadata'] === 'object'
						? (session['metadata'] as Record<string, unknown>)
						: undefined;
				const userId = typeof metadata?.['userId'] === 'string' ? metadata['userId'] : undefined;
				const customerId = String(session?.['customer'] ?? '');

				log.info('Payment success', { userId, customerId });

				const usersKV = safeKV(env, 'BETA_USERS_KV');
				if (userId && usersKV) {
					await updateUserPlan(usersKV, userId, 'pro', customerId);
					// Persist mapping customerId -> userId to avoid expensive KV scans later
					try {
						await usersKV.put(`stripe:customer:${customerId}`, userId);
					} catch (e: unknown) {
						log.warn('Failed to persist stripe customer mapping', {
							message: createSafeErrorMessage(e)
						});
					}
					log.info('User upgraded to Pro', { userId });
				} else {
					log.error('Missing userId or KV binding', { hasUserId: !!userId, hasUsersKV: !!usersKV });
				}
				break;
			}

			case 'customer.subscription.deleted': {
				const subscription = event.data.object as unknown as Record<string, unknown> | undefined;
				const customerId = String(subscription?.['customer'] ?? '');

				log.info('Subscription cancelled', { customerId });

				const usersKV = safeKV(env, 'BETA_USERS_KV');
				if (usersKV) {
					await downgradeUserByCustomerId(usersKV, customerId);
				}
				break;
			}

			case 'customer.subscription.updated': {
				const subscription = event.data.object as unknown as Record<string, unknown> | undefined;
				const customerId = String(subscription?.['customer'] ?? '');
				const status = String(subscription?.['status'] ?? '');

				log.info('Subscription updated', { customerId, status });

				// Downgrade if subscription becomes inactive
				if (['canceled', 'unpaid', 'past_due'].includes(status)) {
					const usersKV = safeKV(env, 'BETA_USERS_KV');
					if (usersKV) {
						await downgradeUserByCustomerId(usersKV, customerId);
					}
				}
				break;
			}

			default:
				log.info('Unhandled event', { type: event.type });
		}

		return json({ received: true });
	} catch (err: unknown) {
		log.error('❌ Webhook processing error', { message: createSafeErrorMessage(err) });
		return json({ error: 'Processing failed' }, { status: 500 });
	}
};

/**
 * Find user by Stripe customer ID and downgrade to free plan
 */
async function downgradeUserByCustomerId(kv: KVNamespace, stripeCustomerId: string) {
	try {
		// First, try the fast lookup mapping -> avoids scanning entire KV
		try {
			const mappedUserId = await kv.get(`stripe:customer:${stripeCustomerId}`);
			if (mappedUserId) {
				await updateUserPlan(kv, String(mappedUserId), 'free');
				log.info('Downgraded user via mapping', { userId: String(mappedUserId) });
				return;
			}
		} catch (mapErr: unknown) {
			log.warn('Failed to read stripe customer mapping, falling back to scan', {
				message: createSafeErrorMessage(mapErr)
			});
		}

		// Fallback: Search through user records if mapping not found
		const prefix = 'user:';
		let cursor: string | undefined = undefined;

		do {
			type KVListResult = {
				keys: Array<{ name: string }>;
				list_complete?: boolean;
				cursor?: string;
			};
			const list: KVListResult = (await kv.list({ prefix, cursor })) as unknown as KVListResult;

			for (const key of list.keys) {
				const raw = await kv.get(key.name);
				if (raw) {
					const user = JSON.parse(raw) as Record<string, unknown>;
					if (user['stripeCustomerId'] === stripeCustomerId) {
						// Found the user - downgrade them
						await updateUserPlan(kv, String(user['id']), 'free');
						log.info('Downgraded user', { userId: user['id'], email: user['email'] });
						return;
					}
				}
			}

			cursor = list.list_complete ? undefined : list.cursor;
		} while (cursor);

		log.warn('No user found with stripeCustomerId', { stripeCustomerId });
	} catch (err: unknown) {
		log.error('Error downgrading user', { message: createSafeErrorMessage(err) });
		throw err;
	}
}
