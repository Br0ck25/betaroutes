// src/lib/server/session.ts
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';

const COOKIE_NAME = 'session';

/**
 * @deprecated This function is not used in production. Session cookies are set
 * directly in login/verify/webauthn routes with proper security settings.
 * Consider removing this file if not needed.
 */
export function setSessionCookie(cookies: Cookies, user: unknown) {
  cookies.set(COOKIE_NAME, JSON.stringify(user), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !dev, // [!code fix] SECURITY: Use secure cookies in production
    maxAge: 60 * 60 * 24 * 30 // 30 days
  });
}

export function clearSessionCookie(cookies: Cookies) {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

export function getUserFromCookies(cookies: Cookies) {
  const raw = cookies.get(COOKIE_NAME);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
