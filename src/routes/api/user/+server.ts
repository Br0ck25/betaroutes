// src/routes/api/user/+server.ts
import { verifyPasswordForUser } from '$lib/server/auth';
import { safeDO, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';
import { checkRateLimit } from '$lib/server/rateLimit';
import { deleteUser, findUserById, updateUser, type UserCore } from '$lib/server/userService';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface SessionUser {
	id: string;
	email?: string;
	name?: string;
	plan?: 'free' | 'premium' | 'pro' | 'business';
	tripsThisMonth?: number;
	maxTrips?: number;
	resetDate?: string;
}

interface UpdateProfileBody {
	name?: string;
	email?: string;
	currentPassword?: string;
}

// SECURITY (Issue #6): Secure email change flow - requires password re-authentication
export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	try {
		const user = locals.user as SessionUser | null;
		if (!user || !user.id) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		const usersKV = safeKV(env ?? {}, 'BETA_USERS_KV');
		if (!usersKV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		// [!code fix] SECURITY: Rate limit profile updates to prevent KV write abuse
		// Allow 10 profile updates per minute per user
		const { allowed } = await checkRateLimit(usersKV, user.id, 'profile_update', 10, 60);
		if (!allowed) {
			return json({ error: 'Too many profile updates. Please wait.' }, { status: 429 });
		}

		// Parse and validate request body safely
		const bodyUnknown: unknown = await request.json();
		const body: UpdateProfileBody = {};
		if (typeof bodyUnknown === 'object' && bodyUnknown !== null) {
			const raw = bodyUnknown as Record<string, unknown>;
			if (typeof raw['name'] === 'string') body.name = (raw['name'] as string).trim();
			if (typeof raw['email'] === 'string') body.email = (raw['email'] as string).trim();
			if (typeof raw['currentPassword'] === 'string')
				body.currentPassword = raw['currentPassword'] as string;
		}

		// Validate inputs
		if (!body.name && !body.email) {
			return json({ error: 'No data to update' }, { status: 400 });
		}

		// SECURITY: Email changes require password re-authentication to prevent ATO
		// Use authoritative user data from KV (never rely on locals.user.email for ownership decisions)
		let currentEmail: string | undefined;
		try {
			const fresh = await findUserById(usersKV, user.id);
			currentEmail = fresh?.email?.toLowerCase();
		} catch {
			// If fresh lookup fails, do not rely on locals.user for authoritative email
			currentEmail = undefined;
		}

		const newEmail = (body.email as string | undefined)?.toLowerCase();
		const isEmailChange = newEmail && currentEmail && newEmail !== currentEmail;

		if (isEmailChange) {
			// Require current password for email changes
			if (!body.currentPassword) {
				return json({ error: 'Password required to change email address' }, { status: 400 });
			}

			// Verify current password against authoritative KV record
			const verified = await verifyPasswordForUser(usersKV, user.id, body.currentPassword);

			if (!verified) {
				return json({ error: 'Incorrect password' }, { status: 401 });
			}
		}

		// Update the core user record in KV
		const updates: Partial<Pick<UserCore, 'name' | 'email'>> = {};
		if (typeof body.name === 'string') updates.name = body.name;
		if (typeof body.email === 'string') updates.email = body.email;
		if (Object.keys(updates).length > 0) {
			await updateUser(usersKV, user.id, updates);
		}

		// Fetch authoritative fresh record to return to client (avoid using locals.user for sensitive fields)
		let latestUser = null;
		try {
			latestUser = await findUserById(usersKV, user.id);
		} catch {
			// ignore and fall back to locals.user
		}

		// Return a sanitized user payload to the client
		return json({
			success: true,
			user: {
				id: user.id,
				name: body.name ?? latestUser?.name,
				email: body.email ?? latestUser?.email,
				plan: latestUser?.plan ?? user.plan,
				tripsThisMonth: latestUser?.tripsThisMonth ?? user.tripsThisMonth ?? 0,
				maxTrips: latestUser?.maxTrips ?? user.maxTrips ?? 10,
				resetDate: latestUser?.resetDate ?? user.resetDate ?? new Date().toISOString()
			}
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		log.error('Update profile error', { message });

		// Return user-friendly error for common cases
		if (message === 'Email already in use') {
			return json({ error: 'Email already in use' }, { status: 409 });
		}

		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, platform, cookies }) => {
	try {
		const user = locals.user as SessionUser | null;
		if (!user || !user.id) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		const usersKV = safeKV(env ?? {}, 'BETA_USERS_KV');
		if (!usersKV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		const callEnv: { DO_INTERNAL_SECRET?: string } = {};
		const _secret = (env as Record<string, unknown>)['DO_INTERNAL_SECRET'];
		if (typeof _secret === 'string') callEnv.DO_INTERNAL_SECRET = _secret;

		const logsKV = safeKV(env ?? {}, 'BETA_LOGS_KV')!;
		const expensesKV = safeKV(env ?? {}, 'BETA_EXPENSES_KV');
		const mileageKV = safeKV(env ?? {}, 'BETA_MILEAGE_KV');
		const settingsKV = safeKV(env ?? {}, 'BETA_USER_SETTINGS_KV');
		const tripIndex = safeDO(env ?? {}, 'TRIP_INDEX_DO')!;

		const opts: Parameters<typeof deleteUser>[2] = {
			tripsKV: logsKV,
			tripIndexDO: tripIndex,
			env: callEnv
		};
		if (expensesKV) opts.expensesKV = expensesKV;
		if (mileageKV) opts.mileageKV = mileageKV;
		if (settingsKV) opts.settingsKV = settingsKV;

		await deleteUser(usersKV, user.id, opts);

		// Cleanup Cookies
		cookies.delete('session_id', { path: '/' });
		cookies.delete('token', { path: '/' });

		return json({ success: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('Delete account error', { message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
