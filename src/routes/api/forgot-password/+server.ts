// src/routes/api/forgot-password/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findUserByEmail } from '$lib/server/userService';
import { sendPasswordResetEmail } from '$lib/server/email';
import { checkRateLimit } from '$lib/server/rateLimit'; // [!code fix] Rate limiting
import { randomUUID } from 'node:crypto';
import { getEnv, safeKV } from '$lib/server/env';
import { log } from '$lib/server/log';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
  const start = Date.now();
  // [!code fix] Pad response time to mask internal logic (Enumeration Protection)
  const MIN_DURATION = 500;

  const env = getEnv(platform);
  const usersKV = safeKV(env, 'BETA_USERS_KV');
  if (!usersKV) {
    return json({ message: 'Service Unavailable' }, { status: 503 });
  }

  // [!code fix] 1. Rate Limit (DoS Protection)
  // Limit: 5 requests per hour per IP
  const ip = getClientAddress();
  const { allowed } = await checkRateLimit(usersKV, ip, 'forgot_password', 5, 3600);

  if (!allowed) {
    return json({ message: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  // Parse and validate request body without using `any`
  const bodyUnknown: unknown = await request.json();
  let email: string | undefined;
  if (typeof bodyUnknown === 'object' && bodyUnknown !== null && 'email' in bodyUnknown) {
    const candidate = (bodyUnknown as { email: unknown }).email;
    email = typeof candidate === 'string' ? candidate.trim() : undefined;
  }
  if (!email) {
    return json({ message: 'Email is required' }, { status: 400 });
  }

  // [!code fix] 2. Host Header Injection Protection
  // Use server-side config instead of trusting the client-provided 'Host' header
  const baseUrl = env['BASE_URL'] as string | undefined;
  if (!baseUrl) {
    log.error('BASE_URL not configured');
    return json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 3. Logic
  const user = await findUserByEmail(usersKV, email);

  if (user) {
    const token = randomUUID();
    const resetKey = `reset_token:${token}`;

    // Store simple User ID (matches validation endpoint expectation)
    await usersKV.put(resetKey, user.id, { expirationTtl: 3600 });

    // [!code fix] 3. Timing Attack Mitigation
    // Send email in background so response time doesn't leak "User Found" vs "User Not Found"
    // (Email sending takes 200ms+, KV check takes 10ms. Awaiting email reveals user existence.)
    const emailJob = sendPasswordResetEmail(email, token, baseUrl);

    if (platform?.context?.waitUntil) {
      platform.context.waitUntil(emailJob);
    } else {
      // Fallback for dev environments
      emailJob.catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        log.error('Email background send failed', { message });
      });
    }
  }

  // [!code fix] 4. Response Padding
  // Ensure request always takes at least MIN_DURATION ms
  const elapsed = Date.now() - start;
  const delay = Math.max(0, MIN_DURATION - elapsed);
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
  }

  // Always return success
  return json({ success: true, message: 'If an account exists, a reset email has been sent.' });
};
