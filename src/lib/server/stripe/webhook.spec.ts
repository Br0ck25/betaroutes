/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';

// Mock hook for stripe.getStripe
let constructEventStub: (body: string, sig: string, secret: string) => any = () => ({});
vi.mock('$lib/server/stripe', () => ({
	getStripe: () => ({
		webhooks: {
			constructEvent: (body: string, sig: string, secret: string) =>
				constructEventStub(body, sig, secret)
		}
	})
}));

import { POST } from '../../../routes/api/stripe/webhook/+server';
import * as userService from '$lib/server/userService';
import { safeKV } from '$lib/server/env';

function makeReq(body: string, sig = 'sig') {
	return {
		headers: { get: (_k: string) => sig },
		text: async () => body
	} as any;
}

describe('Stripe webhook handler', () => {
	let platform: any;

	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
		// Set webhook secret
		platform.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
	});

	it('handles checkout.session.completed and persists mapping + upgrades user', async () => {
		const usersKV = safeKV(platform.env, 'BETA_USERS_KV')!;

		// Spy on updateUserPlan
		const spy = vi.spyOn(userService, 'updateUserPlan').mockResolvedValue(undefined);

		constructEventStub = () => ({
			type: 'checkout.session.completed',
			data: { object: { metadata: { userId: 'u1' }, customer: 'cus_123' } }
		});

		const req = makeReq(JSON.stringify({}));
		const res = await POST({ request: req, platform } as any);
		const body = (await res.json()) as any;
		expect(body.received).toBe(true);

		expect(spy).toHaveBeenCalledWith(usersKV, 'u1', 'pro', 'cus_123');

		// persisted mapping
		const mapped = await usersKV.get('stripe:customer:cus_123');
		expect(mapped).toBe('u1');

		spy.mockRestore();
	});

	it('handles customer.subscription.deleted and downgrades user via mapping', async () => {
		const usersKV = safeKV(platform.env, 'BETA_USERS_KV')!;
		// Create mapping
		await usersKV.put('stripe:customer:cus_del', 'user_del');

		const spy = vi.spyOn(userService, 'updateUserPlan').mockResolvedValue(undefined);

		constructEventStub = () => ({
			type: 'customer.subscription.deleted',
			data: { object: { customer: 'cus_del' } }
		});

		const req = makeReq(JSON.stringify({}));
		const res = await POST({ request: req, platform } as any);
		const body = (await res.json()) as any;
		expect(body.received).toBe(true);

		expect(spy).toHaveBeenCalledWith(usersKV, 'user_del', 'free');

		spy.mockRestore();
	});

	it('handles customer.subscription.updated and downgrades when status is canceled', async () => {
		const usersKV = safeKV(platform.env, 'BETA_USERS_KV')!;
		await usersKV.put('stripe:customer:cus_upd', 'user_upd');

		const spy = vi.spyOn(userService, 'updateUserPlan').mockResolvedValue(undefined);

		constructEventStub = () => ({
			type: 'customer.subscription.updated',
			data: { object: { customer: 'cus_upd', status: 'canceled' } }
		});

		const req = makeReq(JSON.stringify({}));
		const res = await POST({ request: req, platform } as any);
		const body = (await res.json()) as any;
		expect(body.received).toBe(true);

		expect(spy).toHaveBeenCalledWith(usersKV, 'user_upd', 'free');

		spy.mockRestore();
	});
});
