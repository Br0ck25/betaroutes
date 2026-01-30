// src/routes/api/verify/+server.ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createUser } from '$lib/server/userService';
import { randomUUID } from 'node:crypto';
import { log } from '$lib/server/log';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const token = url.searchParams.get('token');

  // [!code fix] Ensure we have both KVs
  const { getEnv, safeKV } = await import('$lib/server/env');
  const env = getEnv(platform);
  const usersKV = safeKV(env, 'BETA_USERS_KV');
  const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV');

  if (!token || !usersKV || !sessionsKV) {
    log.error('[Verify] Missing token or database connection');
    throw redirect(303, '/login?error=invalid_configuration');
  }

  // 1. Get Pending Data
  const pendingKey = `pending_verify:${token}`;
  const pendingDataRaw = await usersKV.get(pendingKey);

  if (!pendingDataRaw) {
    throw redirect(303, '/login?error=expired_verification');
  }

  const pendingData = JSON.parse(pendingDataRaw);

  try {
    // 2. Create Real User
    const user = await createUser(usersKV, {
      username: pendingData.username,
      email: pendingData.email,
      password: pendingData.password,
      plan: 'free',
      tripsThisMonth: 0,
      maxTrips: 10,
      name: pendingData.username,
      resetDate: new Date().toISOString()
    });

    // 3. Create Session (Corrected for SESSIONS_KV)
    const sessionId = randomUUID();
    const sessionTTL = 60 * 60 * 24 * 30; // 30 Days

    // Session payload: include authoritative id only for ownership; avoid storing email/name used for auth checks
    const sessionData = {
      id: user.id,
      plan: user.plan,
      tripsThisMonth: user.tripsThisMonth,
      maxTrips: user.maxTrips,
      resetDate: user.resetDate,
      role: 'user',
      createdAt: Date.now()
    };

    // Write to SESSIONS_KV
    await sessionsKV.put(sessionId, JSON.stringify(sessionData), {
      expirationTtl: sessionTTL
    });

    // Set Cookie (Issue #5: Changed sameSite from 'none' to 'lax')
    cookies.set('session_id', sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax', // [!code fix] Changed from 'none' for CSRF protection
      secure: true,
      maxAge: sessionTTL
    });

    // 4. Cleanup (Remove all temporary keys)
    await Promise.all([
      usersKV.delete(pendingKey),
      usersKV.delete(`reservation:username:${pendingData.username}`),
      usersKV.delete(`reservation:email:${pendingData.email}`),
      usersKV.delete(`lookup:pending:${pendingData.email}`)
    ]);

    throw redirect(303, '/dashboard?welcome=true');
  } catch (e: unknown) {
    if (e instanceof Response) throw e; // Allow redirects to pass
    const msg = e instanceof Error ? e.message : String(e);
    log.error('[Verify] Error', { message: msg });
    throw redirect(303, '/login?error=creation_failed');
  }
};
