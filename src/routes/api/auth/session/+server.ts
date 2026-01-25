import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '$lib/server/log';

function isRecord(obj: unknown): obj is Record<string, unknown> {
	return typeof obj === 'object' && obj !== null;
}

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const user = locals.user as unknown;
		if (!isRecord(user) || typeof (user as Record<string, unknown>)['id'] !== 'string')
			return json({ error: 'Unauthorized' }, { status: 401 });

		// SECURITY (Issue #9): Strip sensitive credentials before returning
		const u = user as Record<string, unknown>;

		const safeUser = {
			id: u['id'] as string,
			plan: typeof u['plan'] === 'string' ? (u['plan'] as string) : undefined,
			tripsThisMonth: typeof u['tripsThisMonth'] === 'number' ? (u['tripsThisMonth'] as number) : 0,
			maxTrips: typeof u['maxTrips'] === 'number' ? (u['maxTrips'] as number) : 0,
			resetDate: typeof u['resetDate'] === 'string' ? (u['resetDate'] as string) : undefined
			// EXCLUDED: token (session token), stripeCustomerId (PII), name/email (PII)
		};

		return json({ success: true, user: safeUser });
	} catch (e) {
		log.error('[Auth Session] Error', { message: (e as Error)?.message });
		return json({ error: 'Failed to check session' }, { status: 500 });
	}
};
