// src/routes/api/verify/+server.ts
import { dev } from '$app/environment';
import { log } from '$lib/server/log';
import { createUser } from '$lib/server/userService';
import { redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';

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

  // Helper: Safely stringify unknown error/objects for logging without throwing
  function safeStringify(v: unknown) {
    try {
      if (v instanceof Error) return v.message + (v.stack ? `\n${v.stack}` : '');
      return JSON.stringify(v);
    } catch {
      try {
        return String(v);
      } catch {
        return '[unstringifiable]';
      }
    }
  }

  try {
    // 2. Create Real User
    let user;
    try {
      user = await createUser(usersKV, {
        username: pendingData.username,
        email: pendingData.email,
        password: pendingData.password,
        plan: 'free',
        tripsThisMonth: 0,
        maxTrips: 10,
        name: pendingData.username,
        resetDate: new Date().toISOString()
      });
    } catch (createErr: unknown) {
      log.error('[Verify] createUser failed', { error: safeStringify(createErr) });
      // Rollback pending tokens to be safe
      await Promise.all([
        usersKV.delete(pendingKey),
        usersKV.delete(`reservation:username:${pendingData.username}`),
        usersKV.delete(`reservation:email:${pendingData.email}`),
        usersKV.delete(`lookup:pending:${pendingData.email}`)
      ]).catch(() => {});
      throw new Error('User creation failed');
    }

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

    try {
      // Write to SESSIONS_KV
      await sessionsKV.put(sessionId, JSON.stringify(sessionData), {
        expirationTtl: sessionTTL
      });

      // Set Cookie (Issue #5: Changed sameSite from 'none' to 'lax')
      cookies.set('session_id', sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax', // [!code fix] Changed from 'none' for CSRF protection
        secure: !dev,
        maxAge: sessionTTL
      });
    } catch (sessionErr: unknown) {
      log.error('[Verify] session creation failed', { error: safeStringify(sessionErr) });
      // Attempt to cleanup user we just created to avoid dangling accounts in dev
      try {
        await usersKV.delete(`user:${user.id}`);
      } catch {
        // ignore cleanup failures
      }
      throw new Error('Session creation failed');
    }

    // 4. Cleanup (Remove all temporary keys)
    await Promise.all([
      usersKV.delete(pendingKey),
      usersKV.delete(`reservation:username:${pendingData.username}`),
      usersKV.delete(`reservation:email:${pendingData.email}`),
      usersKV.delete(`lookup:pending:${pendingData.email}`)
    ]);

    throw redirect(303, '/dashboard?welcome=true');
  } catch (e: unknown) {
    // Allow SvelteKit Response/Redirect objects to pass through unchanged
    if (e instanceof Response) throw e; // Response-like (safety)

    // SvelteKit's `redirect()` may throw an object with `status` + `location` properties
    // Detect and rethrow those to allow framework-level redirects to succeed.
    if (e && typeof e === 'object' && 'status' in (e as any) && 'location' in (e as any)) {
      throw e;
    }

    const name = e instanceof Error ? e.name : 'Unknown';
    const message = e instanceof Error ? e.message : safeStringify(e);
    log.error('[Verify] Error', { message, name, type: typeof e });

    // Return to login with generic error
    throw redirect(303, '/login?error=creation_failed');
  }
};
