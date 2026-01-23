import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const user = locals.user;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		// SECURITY (Issue #9): Strip sensitive credentials before returning

		const rawUser = user as any;
		const safeUser = {
			id: rawUser.id,
			name: rawUser.name,
			email: rawUser.email,
			plan: rawUser.plan,
			tripsThisMonth: rawUser.tripsThisMonth,
			maxTrips: rawUser.maxTrips,
			resetDate: rawUser.resetDate
			// EXCLUDED: token (session token), stripeCustomerId (PII)
		};

		return json({ success: true, user: safeUser });
	} catch (e) {
		log.error('[Auth Session] Error', { message: (e as Error)?.message });
		return json({ error: 'Failed to check session' }, { status: 500 });
	}
};
