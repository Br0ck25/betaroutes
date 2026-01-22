import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const user = locals.user;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		// SECURITY: Return only safe, public fields. Never expose password_hash, salt, iterations, etc.
		const safeUser = {
			id: (user as any).id,
			email: (user as any).email,
			name: (user as any).name,
			plan: (user as any).plan,
			tripsThisMonth: (user as any).tripsThisMonth,
			maxTrips: (user as any).maxTrips,
			resetDate: (user as any).resetDate
		};

		return json({ success: true, user: safeUser });
	} catch (e) {
		log.error('[Auth Session] Error', { message: (e as any)?.message });
		return json({ error: 'Failed to check session' }, { status: 500 });
	}
};
