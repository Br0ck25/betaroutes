import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findUserByEmail } from '$lib/server/userService';
import { sendPasswordResetEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';
import { randomUUID } from 'node:crypto';
import { getEnv } from '$lib/server/env';

// [!code fix] Hardcode production URL to prevent Host Header Injection
const PRODUCTION_BASE_URL = 'https://gorouteyourself.com';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const start = Date.now();
	// [!code fix] SECURITY: Pad response time to mask internal logic (Enumeration Protection)
	const MIN_DURATION = 500;

	const env = getEnv(platform);
	const usersKV = platform?.env?.BETA_USERS_KV as KVNamespace | undefined;
	if (!usersKV) {
		return json({ message: 'Database Unavailable' }, { status: 503 });
	}

	// [!code fix] SECURITY: Use server-configured BASE_URL to prevent Host Header Injection
	const baseUrl = (env['BASE_URL'] as string) || PRODUCTION_BASE_URL;

	// [!code fix] SECURITY: Rate limit to prevent abuse (5 requests per hour per IP)
	const ip = getClientAddress();
	const { allowed } = await checkRateLimit(usersKV, ip, 'forgot_password', 5, 3600);
	if (!allowed) {
		return json({ message: 'Too many attempts. Please try again later.' }, { status: 429 });
	}

	// Parse and validate request body safely (no `any`)
	const bodyUnknown: unknown = await request.json();
	let email: string | undefined;
	if (typeof bodyUnknown === 'object' && bodyUnknown !== null && 'email' in bodyUnknown) {
		const candidate = (bodyUnknown as { email: unknown }).email;
		email = typeof candidate === 'string' ? candidate.trim() : undefined;
	}

	if (!email) {
		return json({ message: 'Email is required' }, { status: 400 });
	}

	// 1. Find User
	const user = await findUserByEmail(usersKV as unknown as KVNamespace, email);
	// Security: Always return success even if user doesn't exist to prevent email enumeration
	if (!user) {
		// [!code fix] SECURITY: Response padding to mask timing
		const elapsed = Date.now() - start;
		const delay = Math.max(0, MIN_DURATION - elapsed);
		if (delay > 0) await new Promise((r) => setTimeout(r, delay));
		return json({ success: true, message: 'If an account exists, a reset email has been sent.' });
	}

	// 2. Generate Reset Token
	const token = randomUUID();
	const resetKey = `reset_token:${token}`;

	// 3. Store in KV (Expire in 1 hour = 3600 seconds)
	// [!code fix] Store just the userId (simpler, matches api/forgot-password pattern)
	await usersKV.put(resetKey, user.id, { expirationTtl: 3600 });

	// 4. Send Email (use waitUntil if available for background sending)
	// [!code fix] Use baseUrl instead of url.origin to prevent Host Header Injection
	const emailJob = sendPasswordResetEmail(email, token, baseUrl);
	if (platform?.context?.waitUntil) {
		platform.context.waitUntil(emailJob);
	} else {
		await emailJob;
	}

	// [!code fix] SECURITY: Response padding
	const elapsed = Date.now() - start;
	const delay = Math.max(0, MIN_DURATION - elapsed);
	if (delay > 0) await new Promise((r) => setTimeout(r, delay));

	return json({ success: true, message: 'If an account exists, a reset email has been sent.' });
};
