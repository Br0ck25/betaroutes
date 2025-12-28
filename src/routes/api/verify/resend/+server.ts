// src/routes/api/verify/resend/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';

export const POST: RequestHandler = async ({ request, platform, url, getClientAddress }) => {
    const { getEnv, safeKV } = await import('$lib/server/env');
    const env = getEnv(platform);
    const usersKV = safeKV(env, 'BETA_USERS_KV');
    if (!usersKV) return json({ message: 'DB Error' }, { status: 500 });

    // 1. Rate Limit
    const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
    const limitRes = await checkRateLimit(usersKV, clientIp, 'resend_limit', 5, 3600);
    if (!limitRes.allowed) {
        return json({ message: 'Too many requests. Please wait.' }, { status: 429 });
    }

    const body: any = await request.json();
    const { email } = body;
    if (!email) return json({ message: 'Email required' }, { status: 400 });

    const normEmail = email.toLowerCase().trim();

    // 2. Find the Pending Token via Lookup Index
    const token = await usersKV.get(`lookup:pending:${normEmail}`);

    if (!token) {
        // Generic success to prevent email enumeration
        return json({ success: true, message: 'If a pending registration exists, an email has been sent.' });
    }

    // 3. Resend
    const emailSent = await sendVerificationEmail(normEmail, token, url.origin);

    if (!emailSent) {
        return json({ message: 'Failed to send email provider error.' }, { status: 500 });
    }

    return json({ success: true, message: 'Verification email resent.' });
};