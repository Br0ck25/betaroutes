// src/routes/api/reset-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserById, updatePasswordHash } from '$lib/server/userService';
import { z } from 'zod';
import { log } from '$lib/server/log';
import { validatePassword } from '$lib/server/passwordValidation';

// Input validation schema
const resetSchema = z.object({
	token: z.string().min(1, 'Token is required'),
	password: z.string().min(8, 'Password must be at least 8 characters')
});

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	try {
		const { getEnv, safeKV } = await import('$lib/server/env');
		const env = getEnv(platform);
		const kv = safeKV(env, 'BETA_USERS_KV');
		const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');

		if (!kv) {
			return json({ message: 'Service Unavailable' }, { status: 503 });
		}

		const rawBody = await request.json().catch(() => null);

		// 1. Validate Input (zod on unknown)
		const result = resetSchema.safeParse(rawBody);
		if (!result.success) {
			return json(
				{
					message: 'Invalid input',
					errors: result.error.flatten().fieldErrors
				},
				{ status: 400 }
			);
		}

		const { token, password } = result.data;

		// [!code fix] SECURITY (Issue #9): Comprehensive password strength validation
		const passwordCheck = validatePassword(password);
		if (!passwordCheck.valid) {
			return json({ message: passwordCheck.error }, { status: 400 });
		}

		// 2. Validate Token
		// Look up the User ID associated with this reset token
		const resetKey = `reset_token:${token}`;
		const userId = await kv.get(resetKey);

		if (!userId) {
			return json({ message: 'Invalid or expired reset token.' }, { status: 400 });
		}

		// 3. Fetch User Record
		// Must use service to ensure we get the full record (Core + Stats)
		if (typeof userId !== 'string') {
			return json({ message: 'Invalid or expired reset token.' }, { status: 400 });
		}
		const user = await findUserById(kv, userId);
		if (!user) {
			return json({ message: 'User not found.' }, { status: 404 });
		}

		// 4. Hash New Password
		const newHash = await hashPassword(password);

		// 5. Update Password Securely
		// [Corrective Action] Use updatePasswordHash to prevent phantom writes/data loss
		await updatePasswordHash(kv, user, newHash);

		// 6. Security: Cleanup & Session Invalidation
		// Delete the used token immediately
		await kv.delete(resetKey);

		// Optional: Invalidate all existing sessions for this user to force re-login
		// (Highly recommended after a password reset)
		if (sessionsKV) {
			const activeSessionsKey = `active_sessions:${userId}`;
			const activeRaw = await sessionsKV.get(activeSessionsKey);
			if (activeRaw) {
				try {
					const sessions = JSON.parse(activeRaw) as string[];
					await Promise.all(sessions.map((s) => sessionsKV.delete(s)));
				} catch {
					// Non-critical - fall back to removing the index
				}
				await sessionsKV.delete(activeSessionsKey);
			}
		}

		// Clear any session cookies on this client
		cookies.delete('session_id', { path: '/' });
		cookies.delete('__Host-session_id', { path: '/' });

		return json({ success: true, message: 'Password reset successfully. Please log in.' });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log.error('Reset password error', { message: msg });
		return json({ message: 'Internal Server Error' }, { status: 500 });
	}
};
