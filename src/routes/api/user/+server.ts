// src/routes/api/user/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
// [!code change] Import updateUser
import { deleteUser, updateUser } from '$lib/server/userService';
import { log } from '$lib/server/log';
import { safeKV, safeDO } from '$lib/server/env';
import { sendVerificationEmail } from '$lib/server/email';
import { randomUUID } from 'node:crypto';

// [!code ++] Add PUT handler for profile updates
export const PUT: RequestHandler = async ({ request, locals, platform, url }) => {
	try {
		const user = locals.user as any;
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		const env = platform?.env;
		if (!env || !env.BETA_USERS_KV) {
			return json({ error: 'Service Unavailable' }, { status: 503 });
		}

		const body: any = await request.json();

		// Validate inputs
		if (!body.name && !body.email) {
			return json({ error: 'No data to update' }, { status: 400 });
		}

		// SECURITY: Email changes require verification - do NOT update immediately
		if (body.email && body.email !== user.email) {
			const newEmail = body.email.toLowerCase().trim();

			// Check if email is already in use
			const { findUserByEmail } = await import('$lib/server/userService');
			const existingUser = await findUserByEmail(env.BETA_USERS_KV as any, newEmail);
			if (existingUser && existingUser.id !== user.id) {
				return json({ error: 'Email already in use' }, { status: 409 });
			}

			// Generate verification token
			const verificationToken = randomUUID();
			const ttl = 86400; // 24 hours

			// Store pending email change
			const pendingChange = {
				userId: user.id,
				currentEmail: user.email,
				newEmail: newEmail,
				createdAt: new Date().toISOString()
			};

			await (env.BETA_USERS_KV as any).put(
				`pending_email_change:${verificationToken}`,
				JSON.stringify(pendingChange),
				{ expirationTtl: ttl }
			);

			// Send verification email to the NEW email address
			try {
				const resendApiKey = (env as any)['RESEND_API_KEY'] as string | undefined;
				await sendVerificationEmail(newEmail, verificationToken, url.origin, resendApiKey);
			} catch (emailErr) {
				log.error('Failed to send email verification', { message: (emailErr as any)?.message });
				// Cleanup pending change
				await (env.BETA_USERS_KV as any).delete(`pending_email_change:${verificationToken}`);
				return json({ error: 'Failed to send verification email' }, { status: 500 });
			}

			// If only email was provided (no name change), return here
			if (!body.name) {
				return json({
					success: true,
					message: 'Verification email sent to new address. Please confirm to complete the change.',
					emailPending: true
				});
			}
		}

		// Update name only (email requires verification)
		const updateData: { name?: string } = {};
		if (body.name) {
			updateData.name = body.name;
		}

		if (Object.keys(updateData).length > 0) {
			await updateUser(env.BETA_USERS_KV as any, (user as any).id, updateData);
		}

		const responseMessage =
			body.email && body.email !== user.email
				? 'Profile updated. Verification email sent to new address.'
				: 'Profile updated successfully.';

		return json({
			success: true,
			message: responseMessage,
			user: { ...user, ...updateData },
			emailPending: body.email && body.email !== user.email
		});
	} catch (err: any) {
		log.error('Update profile error', { message: err?.message });
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
			settingsKV: safeKV(env, 'BETA_USER_SETTINGS_KV'),
			tripIndexDO: safeDO(env, 'TRIP_INDEX_DO')!
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
