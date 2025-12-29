import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findUserByEmail } from '$lib/server/userService';
import { sendPasswordResetEmail } from '$lib/server/email';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async ({ request, platform, url }) => {
	const usersKV = platform?.env?.BETA_USERS_KV;
	if (!usersKV) {
		return json({ message: 'Database Unavailable' }, { status: 503 });
	}

	const body: any = await request.json();
	const { email } = body;

	if (!email) {
		return json({ message: 'Email is required' }, { status: 400 });
	}

	// 1. Find User
	const user = await findUserByEmail(
		usersKV as unknown as import('@cloudflare/workers-types').KVNamespace,
		email
	);
	// Security: Always return success even if user doesn't exist to prevent email enumeration
	if (!user) {
		// Fake a delay to mimic processing time
		await new Promise((r) => setTimeout(r, 500));
		return json({ success: true });
	}

	// 2. Generate Reset Token
	const token = randomUUID();
	const resetKey = `reset_token:${token}`;

	// 3. Store in KV (Expire in 1 hour = 3600 seconds)
	const resetData = {
		userId: user.id,
		email: user.email,
		expiresAt: Date.now() + 3600 * 1000
	};

	await usersKV.put(resetKey, JSON.stringify(resetData), { expirationTtl: 3600 });

	// 4. Send Email
	await sendPasswordResetEmail(email, token, url.origin);

	return json({ success: true });
};
