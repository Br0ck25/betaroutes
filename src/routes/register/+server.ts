// src/routes/register/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';
import { findUserByEmail, findUserByUsername } from '$lib/server/userService';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';
import { log } from '$lib/server/log';
import { validatePassword } from '$lib/server/passwordValidation';

// [!code fix] Hardcode production URL to prevent Host Header Injection
const PRODUCTION_BASE_URL = 'https://gorouteyourself.com';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
	log.info('[Register] START REGISTRATION', {
		hostname: url.hostname,
		platform: !!platform,
		envPresent: !!platform?.env
	});

	try {
		// 1. Check Database Binding
		const { getEnv, safeKV } = await import('$lib/server/env');
		const env = getEnv(platform);
		const usersKV = safeKV(env, 'BETA_USERS_KV');
		if (!usersKV) {
			log.error('[Register] CRITICAL: BETA_USERS_KV binding missing');
			return json(
				{
					message: 'Database service unavailable',
					debug: { error: 'BETA_USERS_KV binding not configured' }
				},
				{ status: 503 }
			);
		}
		log.info('[Register] ✅ KV binding present');

		// 1.5. Check Email Configuration
		const resendKey = env['RESEND_API_KEY'] as string | undefined;
		const isProduction = !url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1');

		if (!resendKey && isProduction) {
			log.error('[Register] CRITICAL: RESEND_API_KEY is missing in production');
			return json(
				{
					message: 'Email service not configured. Please contact support.',
					debug: { error: 'RESEND_API_KEY environment variable missing' }
				},
				{ status: 503 }
			);
		}
		log.info('[Register] ✅ Email key present', { hasResendKey: !!resendKey });

		// 2. Rate Limit
		log.info('[Register] Checking rate limit');
		const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
		let limitResult = { allowed: true };
		try {
			limitResult = await checkRateLimit(usersKV, clientIp, 'register_attempt', 15, 3600);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			log.warn('[Register] Rate limit check failed (ignoring)', { message: msg });
		}

		if (!limitResult.allowed) {
			return json(
				{ message: 'Too many registration attempts. Please try again later.' },
				{ status: 429 }
			);
		}
		log.info('[Register] Rate limit passed');

		// 3. Parse Body
		const body = (await request.json()) as { username?: string; email?: string; password?: string };
		const { username, email, password } = body;
		// Use sanitized logging to avoid leaking secrets (passwords, tokens, emails)
		log.info('[Register] Request body parsed', {
			hasUsername: !!username,
			hasEmail: !!email,
			hasPassword: !!password
		});

		// 4. Validation
		if (!username || !email || !password) {
			return json(
				{
					message: 'Missing required fields',
					debug: {
						hasUsername: !!username,
						hasEmail: !!email,
						hasPassword: !!password
					}
				},
				{ status: 400 }
			);
		}

		// Validate password strength
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return json(
				{
					message: passwordValidation.error || 'Password does not meet security requirements',
					passwordStrength: passwordValidation.strength
				},
				{ status: 400 }
			);
		}

		const normEmail = email.toLowerCase().trim();
		const normUser = username.toLowerCase().trim();
		log.info('[Register] ✅ Validation passed');

		// 5. Check Existing Users
		log.info('[Register] Checking for existing users');
		const existingEmail = await findUserByEmail(usersKV, normEmail);
		if (existingEmail) {
			return json({ message: 'Email already in use.' }, { status: 409 });
		}

		const existingUser = await findUserByUsername(usersKV, normUser);
		if (existingUser) {
			return json({ message: 'Username taken.' }, { status: 409 });
		}
		log.info('[Register] ✅ User is new');

		// 6. Check Reservations
		log.info('[Register] Checking reservations');
		const [resUser, resEmail] = await Promise.all([
			usersKV.get(`reservation:username:${normUser}`),
			usersKV.get(`reservation:email:${normEmail}`)
		]);

		if (resUser || resEmail) {
			return json({ message: 'Username or Email is pending verification.' }, { status: 409 });
		}
		log.info('[Register] ✅ No conflicting reservations');

		// 7. Hash Password
		log.info('[Register] Hashing password');
		const hashedPassword = await hashPassword(password);
		log.info('[Register] ✅ Password hashed');

		// 8. Create Pending Record
		const verificationToken = randomUUID();
		// Token generated — do not log token contents. Log only that token was created.
		log.info('[Register] Generated verification token');

		const pendingUser = {
			username: normUser,
			email: normEmail,
			password: hashedPassword,
			createdAt: new Date().toISOString()
		};

		const ttl = 86400; // 24 hours

		// 9. Store in KV
		log.info('[Register] Writing to KV');
		await Promise.all([
			(
				usersKV as unknown as {
					put: (k: string, v: string, opts?: { expirationTtl?: number }) => Promise<void>;
				}
			).put(`pending_verify:${verificationToken}`, JSON.stringify(pendingUser), {
				expirationTtl: ttl
			}),
			usersKV.put(`reservation:username:${normUser}`, verificationToken, { expirationTtl: ttl }),
			usersKV.put(`reservation:email:${normEmail}`, verificationToken, { expirationTtl: ttl }),
			usersKV.put(`lookup:pending:${normEmail}`, verificationToken, { expirationTtl: ttl })
		]);
		log.info('[Register] KV writes complete');

		// 10. Send Email - THIS IS THE CRITICAL FIX
		log.info('[Register] Sending verification email');
		let emailSent = false;
		try {
			// Import check
			if (typeof sendVerificationEmail !== 'function') {
				throw new Error('sendVerificationEmail is not a function - import failed');
			}

			// CRITICAL: Pass the API key from env helper
			const resendApiKey = env['RESEND_API_KEY'] as string | undefined;
			// [!code fix] Use server-configured BASE_URL to prevent Host Header Injection
			const baseUrl = (env['BASE_URL'] as string) || PRODUCTION_BASE_URL;
			emailSent = await sendVerificationEmail(normEmail, verificationToken, baseUrl, resendApiKey);
			log.info('[Register] ✅ Email sent successfully');
		} catch (emailErr: unknown) {
			const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
			const name = emailErr instanceof Error ? (emailErr as Error).name : undefined;
			log.error('[Register] Email send failed', {
				message: msg,
				name
			});

			// Rollback pending registration
			await Promise.all([
				usersKV.delete(`pending_verify:${verificationToken}`),
				usersKV.delete(`reservation:username:${normUser}`),
				usersKV.delete(`reservation:email:${normEmail}`),
				usersKV.delete(`lookup:pending:${normEmail}`)
			]);

			return json(
				{
					message: 'Failed to send verification email. Please try again.',
					debug: {
						error: msg,
						name
					}
				},
				{ status: 500 }
			);
		}

		if (!emailSent) {
			log.error('[Register] Email service returned false');

			// Rollback
			await Promise.all([
				usersKV.delete(`pending_verify:${verificationToken}`),
				usersKV.delete(`reservation:username:${normUser}`),
				usersKV.delete(`reservation:email:${normEmail}`),
				usersKV.delete(`lookup:pending:${normEmail}`)
			]);

			return json(
				{
					message: 'Failed to send verification email.',
					debug: { error: 'Email service returned false' }
				},
				{ status: 500 }
			);
		}

		log.info('[Register] ===== SUCCESS =====');
		return json({
			success: true,
			message: 'Verification email sent. Please check your inbox.'
		});
	} catch (e: unknown) {
		const name = e instanceof Error ? e.name : 'Unknown';
		const message = e instanceof Error ? e.message : String(e);
		log.error('[Register] CRITICAL ERROR', { message, name, type: typeof e });

		// Return a safe error message without exposing stacks or secrets
		return json(
			{
				message: 'Registration failed. Please try again.',
				debug: { error: message || 'Unknown error', name: name || 'Unknown', type: typeof e }
			},
			{ status: 500 }
		);
	}
};
