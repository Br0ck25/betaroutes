// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteUser, updateUser } from '$lib/server/userService';
import { authenticateUser } from '$lib/server/auth';
import { log } from '$lib/server/log';
import { safeKV, safeDO } from '$lib/server/env';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getUserDisplayName } from '$lib/utils/user-display';

// SECURITY (Issue #6): Secure email change flow - requires password re-authentication
export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	try {
		const user = locals.user as any;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		if (!env || !env.BETA_USERS_KV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		// [!code fix] SECURITY: Rate limit profile updates to prevent KV write abuse
		// Allow 10 profile updates per minute per user
		const { allowed } = await checkRateLimit(
			env.BETA_USERS_KV as any,
			user.id,
			'profile_update',
			10,
			60
		);
		if (!allowed) {
			return json({ error: 'Too many profile updates. Please wait.' }, { status: 429 });
		}

		const body = (await request.json()) as any;

		// Validate inputs
		if (!body.name && !body.email) {
			return json({ error: 'No data to update' }, { status: 400 });
		}

		// SECURITY: Email changes require password re-authentication to prevent ATO
		const currentEmail = (user.email as string | undefined)?.toLowerCase();
		const newEmail = (body.email as string | undefined)?.toLowerCase();
		const isEmailChange = newEmail && currentEmail && newEmail !== currentEmail;

		if (isEmailChange) {
			// Require current password for email changes
			if (!body.currentPassword) {
				return json({ error: 'Password required to change email address' }, { status: 400 });
			}

			// Verify current password

			const authUser = await authenticateUser(
				env.BETA_USERS_KV as any,
				user.email || user.name || '',
				body.currentPassword
			);

			if (!authUser) {
				return json({ error: 'Incorrect password' }, { status: 401 });
			}
		}

		// Update the core user record in KV

		await updateUser(env.BETA_USERS_KV as any, user.id, {
			name: body.name,
			email: body.email
		});

		return json({
			success: true,
			user: {
				...user,
				name: body.name ?? getUserDisplayName(user),
				email: body.email ?? user.email
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
		const user = locals.user as any;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		if (!env || !env.BETA_USERS_KV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		await deleteUser(safeKV(env, 'BETA_USERS_KV')!, user.id, {
			tripsKV: safeKV(env, 'BETA_LOGS_KV')!,
			expensesKV: safeKV(env, 'BETA_EXPENSES_KV'),
			mileageKV: safeKV(env, 'BETA_MILEAGE_KV'),
			trashKV: safeKV(env, 'BETA_TRASH_KV'),
			settingsKV: safeKV(env, 'BETA_USER_SETTINGS_KV'),
			tripIndexDO: safeDO(env, 'TRIP_INDEX_DO')!,
			env: {
				DO_INTERNAL_SECRET: (env as Record<string, unknown>)['DO_INTERNAL_SECRET'] as
					| string
					| undefined
			}
		});

		// Cleanup Cookies
		cookies.delete('session_id', { path: '/' });
		cookies.delete('token', { path: '/' });

		return json({ success: true });
	} catch (err: any) {
		log.error('Delete account error', { message: err?.message });
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
