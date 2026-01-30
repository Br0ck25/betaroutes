// src/lib/server/csrf.ts
//
// CSRF Protection Implementation
// Uses double-submit cookie pattern with cryptographic validation
// Per SECURITY.md: "CSRF token mechanism (recommended: double-submit cookie + header)"

import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';

/**
 * CSRF token configuration
 */
const CSRF_COOKIE_NAME = '__csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32; // bytes (256 bits)

/**
 * Paths that are exempt from CSRF protection
 * Typically: webhooks, public APIs, authentication endpoints
 */
const EXEMPT_PATHS = [
  '/api/webhooks/', // Webhook callbacks (verified via signatures)
  '/login', // Login uses different protection (credentials)
  '/register', // Registration is creation, not mutation of existing data
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh'
];

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate CSRF token and set it in a cookie
 * Should be called at the start of every request
 *
 * @param event - SvelteKit RequestEvent
 * @returns The generated CSRF token (nonce)
 */
export function generateCsrfToken(event: RequestEvent): string {
  // Check if token already exists in cookie
  const existingToken = event.cookies.get(CSRF_COOKIE_NAME);

  // Reuse existing token if valid (avoids constant regeneration)
  if (existingToken && existingToken.length === TOKEN_LENGTH * 2) {
    return existingToken;
  }

  // Generate new token
  const token = generateSecureToken();

  // Set cookie with strict security settings
  event.cookies.set(CSRF_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true, // JavaScript cannot access
    secure: !dev, // HTTPS only in production
    sameSite: 'strict', // Strongest CSRF protection
    maxAge: 60 * 60 * 24 // 24 hours
  });

  return token;
}

/**
 * Validate CSRF token for state-changing requests
 * Implements double-submit cookie pattern with strict validation
 *
 * @param event - SvelteKit RequestEvent
 * @returns Error response if validation fails, null if validation passes
 */
export async function csrfProtection(event: RequestEvent): Promise<Response | null> {
  const method = event.request.method.toUpperCase();

  // Only protect state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return null;
  }

  // Check if path is exempt
  const pathname = event.url.pathname;
  const isExempt = EXEMPT_PATHS.some((exemptPath) => pathname.startsWith(exemptPath));

  if (isExempt) {
    return null;
  }

  // Get token from cookie
  const cookieToken = event.cookies.get(CSRF_COOKIE_NAME);

  if (!cookieToken) {
    return new Response(
      JSON.stringify({
        error: 'CSRF token missing',
        message: 'Session expired or invalid. Please refresh the page.'
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Get token from header
  const headerToken = event.request.headers.get(CSRF_HEADER_NAME);

  if (!headerToken) {
    return new Response(
      JSON.stringify({
        error: 'CSRF token missing',
        message: 'Security token not found. Please refresh the page.'
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Validate tokens match (timing-safe comparison)
  if (!timingSafeEqual(cookieToken, headerToken)) {
    return new Response(
      JSON.stringify({
        error: 'CSRF validation failed',
        message: 'Security validation failed. Please refresh the page and try again.'
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Validation passed
  return null;
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Different lengths = not equal (but still compute to prevent timing leak)
  const lengthEqual = a.length === b.length;

  // Use fixed-length comparison to prevent timing attacks
  const maxLength = Math.max(a.length, b.length);
  let result = 0;

  for (let i = 0; i < maxLength; i++) {
    // XOR characters (or 0 if out of bounds)
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    result |= charA ^ charB;
  }

  return lengthEqual && result === 0;
}

/**
 * Get CSRF token for use in client-side requests
 * Returns the token from the cookie (server-side only)
 *
 * @param event - SvelteKit RequestEvent
 * @returns CSRF token or null
 */
export function getCsrfToken(event: RequestEvent): string | null {
  return event.cookies.get(CSRF_COOKIE_NAME) ?? null;
}

/**
 * Clear CSRF token (useful on logout)
 *
 * @param event - SvelteKit RequestEvent
 */
export function clearCsrfToken(event: RequestEvent): void {
  event.cookies.delete(CSRF_COOKIE_NAME, { path: '/' });
}
