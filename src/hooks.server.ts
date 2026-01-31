// src/hooks.server.ts
import { dev } from '$app/environment';
import { csrfProtection, generateCsrfToken } from '$lib/server/csrf';
import { log } from '$lib/server/log';
import { findUserById } from '$lib/server/userService';
import type { Handle } from '@sveltejs/kit';

// SECURITY: JSON payload size limit (1MB default, prevents DoS)
const MAX_JSON_PAYLOAD_SIZE = 1 * 1024 * 1024; // 1MB

// SECURITY: Prototype pollution dangerous keys
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

// SECURITY: UUID v4 validation (strict)
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// SECURITY: Content Security Policy (extracted for maintainability)
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://fonts.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https: blob:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://maps.googleapis.com https://places.googleapis.com https://cloudflareinsights.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

/**
 * Recursively check for prototype pollution keys in an object.
 * Uses Reflect.ownKeys to catch non-enumerable properties.
 */
function hasPrototypePollution(obj: unknown, depth = 0): boolean {
  // Prevent infinite recursion
  if (depth > 20) return false;
  if (obj === null || typeof obj !== 'object') return false;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasPrototypePollution(item, depth + 1)) return true;
    }
    return false;
  }

  // Use Reflect.ownKeys to catch symbols and non-enumerable properties
  const keys = Reflect.ownKeys(obj);
  for (const key of keys) {
    if (typeof key === 'string' && DANGEROUS_KEYS.includes(key)) {
      return true;
    }
    // @ts-expect-error - Reflect.ownKeys returns string | symbol, safe to access
    if (hasPrototypePollution(obj[key], depth + 1)) return true;
  }

  return false;
}

export const handle: Handle = async ({ event, resolve }) => {
  // DEV: Ensure mock KVs are configured when running locally or in manual server mode
  if (dev || process.env['NODE_ENV'] !== 'production' || process.env['PW_MANUAL_SERVER'] === '1') {
    try {
      const { setupMockKV } = await import('$lib/server/dev-mock-db');
      await setupMockKV(event as { platform?: { env?: Record<string, unknown> } });
      log.info('[DEV] Mock KV setup complete');
    } catch (err: unknown) {
      log.warn('[DEV] setupMockKV failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // 1. SECURITY: Request Size Limiting & Prototype Pollution Check
  if (event.request.method === 'POST' || event.request.method === 'PUT') {
    const contentLength = Number(event.request.headers.get('content-length'));
    if (contentLength > MAX_JSON_PAYLOAD_SIZE) {
      return new Response('Payload too large', { status: 413 });
    }

    // Clone request to check body without consuming it
    try {
      const clone = event.request.clone();
      const text = await clone.text();
      if (text) {
        const body = JSON.parse(text);
        if (hasPrototypePollution(body)) {
          log.warn('[SECURITY] Prototype pollution attempt blocked', {
            ip: event.getClientAddress()
          });
          return new Response('Bad Request', { status: 400 });
        }
      }
    } catch {
      // Ignore JSON parse errors here, let SvelteKit handle them
    }
  }

  // 2. SECURITY: CSRF Protection
  const csrfError = await csrfProtection(event);
  if (csrfError) return csrfError;

  // Generate new token for this request (double-submit cookie pattern)
  // We intentionally do NOT inject this into page markup (%sveltekit.nonce% is for CSP nonces)
  // Per SECURITY.md: set an HttpOnly server cookie and a readable mirror cookie for client-side reads
  generateCsrfToken(event);

  // 3. AUTHENTICATION: Zero-Trust Session Validation
  const sessionId = event.cookies.get('session_id');
  event.locals.user = null;

  if (sessionId && event.platform?.env) {
    try {
      // 1) Validate sessionId format
      if (!UUID_V4_REGEX.test(sessionId)) {
        throw new Error('Invalid session id format');
      }

      // 2) Look up the session record in the SESSIONS KV
      const sessionsKV = event.platform.env.BETA_SESSIONS_KV as
        | {
            get: (k: string) => Promise<string | null>;
          }
        | undefined;

      if (!sessionsKV) {
        // Sessions store not available (dev/test may mock differently)
        throw new Error('SESSIONS_KV unavailable');
      }

      const sessionRaw = await sessionsKV.get(sessionId);
      if (!sessionRaw) {
        // No session found - treat as unauthenticated
        throw new Error('Session not found');
      }

      // 3) Parse session and fetch the authoritative user record
      const session = JSON.parse(sessionRaw) as { id?: string };
      const userId = session?.id;
      if (!userId || !UUID_V4_REGEX.test(userId)) {
        throw new Error('Invalid user id in session');
      }

      const user = await findUserById(event.platform.env.BETA_USERS_KV, userId);
      if (user) {
        event.locals.user = {
          id: user.id,
          token: sessionId,
          plan: user.plan === 'premium' ? 'premium' : 'free',
          tripsThisMonth: 0,
          maxTrips: user.maxTrips,
          resetDate: new Date().toISOString(),
          name: user.username,
          email: user.email,
          ...(user.stripeCustomerId ? { stripeCustomerId: user.stripeCustomerId } : {})
        };
      }
    } catch (error) {
      log.error('[AUTH] Session validation failed', { error });
      // Fail closed. User remains null.
    }
  }

  // 4. RESPONSE: Security Headers & CSP
  // Note: We do not inject CSRF tokens into page markup. Cookies are used (double-submit pattern).
  const response = await resolve(event);

  // Apply strict security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
  );

  // HSTS (production only)
  if (!dev) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Content Security Policy (CSP) - Apply dev-relaxed directives when running in dev for local convenience
  // Note: Per SECURITY.md, production remains strict (no 'unsafe-inline' for scripts)
  const cspDirectives = [
    "default-src 'self'",
    dev
      ? "script-src 'self' https://fonts.googleapis.com 'unsafe-inline' 'unsafe-hashes'"
      : "script-src 'self' https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://maps.googleapis.com https://places.googleapis.com https://cloudflareinsights.com",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];

  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // Cache-Control headers for static assets
  // - Hashed app assets => 1 year, immutable
  // - Other static assets => 30 days
  try {
    if (event.request.method === 'GET' && response.status === 200) {
      const existing = response.headers.get('cache-control');
      if (!existing) {
        const urlPath = event.url.pathname.toLowerCase();
        const oneYear = 'public, max-age=31536000, immutable';

        // We don't cache HTML responses in the browser cache to prevent stale auth states
        const isHtml = urlPath.endsWith('/') || urlPath.endsWith('.html') || urlPath === '/';

        if (!isHtml) {
          const isHashedAsset = urlPath.startsWith('/_app/') || /\.[a-f0-9]{8,}\./.test(urlPath);
          if (isHashedAsset) {
            response.headers.set('Cache-Control', oneYear);
          } else if (/\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|json|css|js|woff2?)$/.test(urlPath)) {
            // Public static assets
            response.headers.set('Cache-Control', 'public, max-age=2592000, immutable');
          }
        } else {
          // HTML / Data: No Store (Prevent back-button sensitive data leak)
          response.headers.set('Cache-Control', 'no-store, must-revalidate');
          response.headers.set('Pragma', 'no-cache');
        }
      }
    }
  } catch {
    // Ignore header errors
  }

  return response;
};
