// src/routes/api/change-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateUser, hashPassword } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService';
import { getEnv, safeKV } from '$lib/server/env';
import { validatePassword } from '$lib/server/passwordValidation';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	// 1. Ensure user is logged in
	if (!locals.user) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const body: any = await request.json();
	const { currentPassword, newPassword } = body;

	if (!currentPassword || !newPassword) {
		return json({ message: 'Current and new password are required' }, { status: 400 });
	}

	// [!code fix] SECURITY (Issue #9): Comprehensive password strength validation
	const passwordCheck = validatePassword(newPassword);
	if (!passwordCheck.valid) {
		return json({ message: passwordCheck.error }, { status: 400 });
	}

	const env = getEnv(platform);
	const usersKV = safeKV(env, 'BETA_USERS_KV');
	if (!usersKV) {
		return json({ message: 'Database unavailable' }, { status: 500 });
	}

	// 2. Verify Current Password
	// Use the session's email or name to verify the "currentPassword" provided by the user
	const authUser = await authenticateUser(
		usersKV,
		(locals.user as any).email || (locals.user as any).name,
		currentPassword
	);

	if (!authUser) {
		return json({ message: 'Incorrect current password' }, { status: 401 });
	}

	// 3. Get Full User Record
	// We need the full record (including internal fields) to update it safely
	const fullUser = await findUserById(usersKV, authUser.id);
	if (!fullUser) {
		return json({ message: 'User record not found' }, { status: 404 });
	}

	// 4. Hash New Password
	const newHash = await hashPassword(newPassword);

	// 5. Update in KV
	await updatePasswordHash(usersKV, fullUser, newHash);

	// [!code fix] SECURITY (Issue #10): Invalidate all sessions after password change
	const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');
	if (sessionsKV) {
		const currentSessionId = locals.user?.token;

		// Try to find and invalidate other sessions for this user
		const activeSessionsKey = `active_sessions:${fullUser.id}`;
		const sessionsList = await sessionsKV.get(activeSessionsKey);

		if (sessionsList) {
			try {
				const sessions = JSON.parse(sessionsList) as string[];

				// Delete all sessions except current one
				for (const sessionId of sessions) {
					if (sessionId !== currentSessionId) {
						await sessionsKV.delete(sessionId);
						log.info('[ChangePassword] Invalidated session', { sessionId: sessionId.slice(0, 8) });
					}
				}

				// Update active sessions list with only current session
				await sessionsKV.put(activeSessionsKey, JSON.stringify([currentSessionId]));
			} catch (err) {
				log.error('[ChangePassword] Failed to invalidate sessions', { error: String(err) });
			}
		}
	}

	return json({
		success: true,
		message: 'Password changed successfully. Other devices have been logged out.'
	});
};
