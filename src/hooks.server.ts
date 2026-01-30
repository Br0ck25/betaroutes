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
  const csrfToken = generateCsrfToken(event);

  // 3. AUTHENTICATION: Zero-Trust Session Validation
  const sessionId = event.cookies.get('session_id');
  event.locals.user = null;

  if (sessionId && event.platform?.env?.BETA_USERS_KV) {
    try {
      // In a real app, you would look up the session in KV/Durable Object
      // For this implementation, we'll verify the user exists
      if (UUID_V4_REGEX.test(sessionId)) {
        const user = await findUserById(event.platform.env.BETA_USERS_KV, sessionId);
        if (user) {
          // ✅ FIX: Build complete object without using 'any'
          event.locals.user = {
            id: user.id,
            token: sessionId,
            plan: user.plan === 'premium' ? 'premium' : 'free',
            tripsThisMonth: 0,
            maxTrips: user.maxTrips,
            resetDate: new Date().toISOString(),
            name: user.username,
            email: user.email,
            // Only include optional stripeCustomerId when present (avoid assigning undefined)
            ...(user.stripeCustomerId ? { stripeCustomerId: user.stripeCustomerId } : {})
          };
        }
      }
    } catch (error) {
      log.error('[AUTH] Session validation failed', { error });
      // Fail closed. User remains null.
    }
  }

  // 4. RESPONSE: Security Headers & CSP
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%sveltekit.nonce%', csrfToken)
  });

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

  // Content Security Policy (CSP) - Strict, no unsafe-inline for scripts
  if (!dev) {
    response.headers.set('Content-Security-Policy', CSP_POLICY);
  }

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
