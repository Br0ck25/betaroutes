// src/routes/api/verify/resend/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendVerificationEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit';

// [!code fix] Hardcode production URL to prevent Host Header Injection
const PRODUCTION_BASE_URL = 'https://gorouteyourself.com';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
  const { getEnv, safeKV } = await import('$lib/server/env');
  const env = getEnv(platform);
  const usersKV = safeKV(env, 'BETA_USERS_KV');
  if (!usersKV) return json({ message: 'DB Error' }, { status: 500 });

  // [!code fix] SECURITY: Use server-configured BASE_URL to prevent Host Header Injection
  const baseUrl = (env['BASE_URL'] as string) || PRODUCTION_BASE_URL;

  // 1. Rate Limit
  const clientIp = request.headers.get('CF-Connecting-IP') || getClientAddress();
  const limitRes = await checkRateLimit(usersKV, clientIp, 'resend_limit', 5, 3600);
  if (!limitRes.allowed) {
    return json({ message: 'Too many requests. Please wait.' }, { status: 429 });
  }

  const rawBody: unknown = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object')
    return json({ message: 'Email required' }, { status: 400 });
  const body = rawBody as Record<string, unknown>;
  const email = typeof body['email'] === 'string' ? (body['email'] as string).trim() : '';
  if (!email) return json({ message: 'Email required' }, { status: 400 });

  const normEmail = email.toLowerCase();

  // 2. Find the Pending Token via Lookup Index
  const token = await usersKV.get(`lookup:pending:${normEmail}`);

  if (!token) {
    // Generic success to prevent email enumeration
    return json({
      success: true,
      message: 'If a pending registration exists, an email has been sent.'
    });
  }

  // 3. Resend
  const emailSent = await sendVerificationEmail(normEmail, token, baseUrl);

  if (!emailSent) {
    return json({ message: 'Failed to send email provider error.' }, { status: 500 });
  }

  return json({ success: true, message: 'Verification email resent.' });
};
