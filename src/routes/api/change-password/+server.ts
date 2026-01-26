// src/routes/api/change-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword, verifyPasswordForUser } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService';
import { getEnv, safeKV } from '$lib/server/env';
import { validatePassword } from '$lib/server/passwordValidation';
import { log } from '$lib/server/log';
import { sendSecurityAlertEmail } from '$lib/server/email';
import { getUserEmail } from '$lib/utils/user-display';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
	// 1. Ensure user is logged in
	if (!locals.user) {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const bodyJson: unknown = await request.json();
	if (!bodyJson || typeof bodyJson !== 'object') {
		return json({ message: 'Bad request' }, { status: 400 });
	}
	const body = bodyJson as Record<string, unknown>;
	const currentPassword =
		typeof body['currentPassword'] === 'string' ? (body['currentPassword'] as string) : '';
	const newPassword =
		typeof body['newPassword'] === 'string' ? (body['newPassword'] as string) : '';

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
	// Use the session's id to verify the "currentPassword" provided by the user
	const currentUserId = locals.user?.id;
	if (!currentUserId || typeof currentUserId !== 'string') {
		return json({ message: 'Unauthorized' }, { status: 401 });
	}

	const valid = await verifyPasswordForUser(usersKV, currentUserId, currentPassword);
	if (!valid) {
		return json({ message: 'Incorrect current password' }, { status: 401 });
	}

	// 3. Get Full User Record
	// We need the full record (including internal fields) to update it safely
	const fullUser = await findUserById(usersKV, currentUserId);
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
		// Get current session id from cookie instead of locals.user.token to avoid relying on legacy fields
		const currentSessionId = cookies.get('session_id');

		// Try to find and invalidate other sessions for this user
		const activeSessionsKey = `active_sessions:${fullUser.id}`;
		const sessionsList = await sessionsKV.get(activeSessionsKey);

		if (sessionsList && typeof sessionsList === 'string') {
			try {
				const parsed = JSON.parse(sessionsList);
				if (Array.isArray(parsed)) {
					const sessions: string[] = parsed.filter((s) => typeof s === 'string');

					// Delete all sessions except current one
					for (const sessionId of sessions) {
						if (currentSessionId && sessionId !== currentSessionId) {
							await sessionsKV.delete(sessionId);
							log.info('[ChangePassword] Invalidated session', {
								sessionId: sessionId.slice(0, 8)
							});
						}
					}

					// Update active sessions list with only current session (if defined)
					const toStore = currentSessionId ? [currentSessionId] : [];
					await sessionsKV.put(activeSessionsKey, JSON.stringify(toStore));
				}
			} catch (err) {
				log.error('[ChangePassword] Failed to invalidate sessions', { error: String(err) });
			}
		}
	}

	// [SECURITY] Send security alert email (best-effort, don't block on failure)
	const email = getUserEmail(fullUser);
	if (email) {
		sendSecurityAlertEmail(email, 'password_changed').catch((err) => {
			log.error('[ChangePassword] Security alert email failed', { error: String(err) });
		});
	}

	return json({
		success: true,
		message: 'Password changed successfully. Other devices have been logged out.'
	});
};
