// src/lib/server/stripe.ts
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { log } from '$lib/server/log';

// Singleton instance to reuse connection
let stripeInstance: Stripe | null = null;

export const getStripe = () => {
	if (!stripeInstance) {
		const key = env['STRIPE_SECRET_KEY'];
		if (!key) {
			log.warn('⚠️ STRIPE_SECRET_KEY is missing. Payments will fail.');
			// Return a dummy instance or throw, depending on preference.
			// For now, we allow it to be created but it will fail calls.
		}

		stripeInstance = new Stripe(key || 'dummy_key', {
			apiVersion: '2023-10-16', // Use latest API version available
			typescript: true
		});
	}
	return stripeInstance;
};
