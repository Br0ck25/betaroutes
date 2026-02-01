// src/hooks.server.ts
import { dev } from '$app/environment';
import { csrfProtection, generateCsrfToken } from '$lib/server/csrf';
import { log } from '$lib/server/log';
import { findUserById } from '$lib/server/userService';
import type { Handle } from '@sveltejs/kit';

// SECURITY: JSON payload size limit (1MB default, prevents DoS)
const MAX_JSON_PAYLOAD_SIZE = 1 * 1024 * 1024; // 1MB

// SECURITY: Prototype pollution dangerous keys
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

// SECURITY: UUID v4 validation (strict)
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlatformEnv = Record<string, unknown>;
type EventLike = { platform?: { env?: unknown } | undefined };

function getPlatformEnv(event: EventLike): PlatformEnv {
  const raw = event.platform?.env;
  if (raw && typeof raw === 'object') return raw as PlatformEnv;
  return {};
}

function envFlag(env: PlatformEnv, key: string): boolean {
  const v = env[key];
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1';
  if (typeof v === 'number') return v === 1;
  return false;
}

function escapeHtmlAttr(value: string): string {
  // Minimal attribute-escape (covers &, ", <, >)
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Recursively check for prototype pollution keys in an object.
 * Uses Reflect.ownKeys to catch non-enumerable properties.
 */
function hasPrototypePollution(obj: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (obj === null || typeof obj !== 'object') return false;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (hasPrototypePollution(item, depth + 1)) return true;
    }
    return false;
  }

  const keys = Reflect.ownKeys(obj);
  for (const key of keys) {
    if (typeof key === 'string' && (DANGEROUS_KEYS as readonly string[]).includes(key)) return true;

    // @ts-expect-error - Reflect.ownKeys returns (string | symbol)[], safe for indexed access at runtime.
    if (hasPrototypePollution(obj[key], depth + 1)) return true;
  }

  return false;
}

function isJsonRequest(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('application/json') || ct.includes('+json');
}

function isKVWithGet(value: unknown): value is { get: (k: string) => Promise<string | null> } {
  if (!value || typeof value !== 'object') return false;
  return 'get' in value && typeof (value as { get?: unknown }).get === 'function';
}

export const handle: Handle = async ({ event, resolve }) => {
  // Treat platform env as a generic record for feature flags and dev helpers.
  const platformEnv = getPlatformEnv(event);
  const manualServer = platformEnv['PW_MANUAL_SERVER'] === '1';

  // DEV: Ensure mock KVs are configured when running locally or in manual server mode
  if (dev || manualServer) {
    try {
      const { setupMockKV } = await import('$lib/server/dev-mock-db');
      await setupMockKV(
        event as unknown as { platform?: { env?: Record<string, unknown> } | undefined }
      );
      log.info('[DEV] Mock KV setup complete');
    } catch (err: unknown) {
      log.warn('[DEV] setupMockKV failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // 1) SECURITY: Request Size Limiting & Prototype Pollution Check (JSON bodies)
  if (event.request.method === 'POST' || event.request.method === 'PUT') {
    const contentLength = Number(event.request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_PAYLOAD_SIZE) {
      return new Response('Payload too large', { status: 413 });
    }

    // Only inspect JSON bodies (avoid reading large form-data / file uploads)
    if (isJsonRequest(event.request.headers.get('content-type'))) {
      try {
        const clone = event.request.clone();
        const text = await clone.text();

        // Defensive guard if content-length was missing/incorrect
        if (text.length > MAX_JSON_PAYLOAD_SIZE) {
          return new Response('Payload too large', { status: 413 });
        }

        if (text) {
          const body = JSON.parse(text) as unknown;
          if (hasPrototypePollution(body)) {
            log.warn('[SECURITY] Prototype pollution attempt blocked', {
              ip: event.getClientAddress()
            });
            return new Response('Bad Request', { status: 400 });
          }
        }
      } catch {
        // Ignore JSON parse errors here; let SvelteKit handle them
      }
    }
  }

  // 2) SECURITY: CSRF Protection (double-submit cookie pattern)
  const csrfError = await csrfProtection(event);
  if (csrfError) return csrfError;

  // - generateCsrfToken(event) should set the HttpOnly CSRF cookie (server-side)
  // - We also ensure a readable mirror cookie + meta tag so client utilities can read it.
  const generated = generateCsrfToken(event);
  const csrfToken =
    typeof generated === 'string' ? generated : (event.cookies.get('csrf_token_readable') ?? '');

  if (csrfToken) {
    try {
      event.cookies.set('csrf_token_readable', csrfToken, {
        path: '/',
        httpOnly: false,
        sameSite: 'strict',
        secure: !dev,
        maxAge: 60 * 60 * 8 // 8 hours
      });
    } catch {
      // Ignore cookie set failures
    }
  }

  // 3) AUTH: Zero-Trust Session Validation
  const sessionId = event.cookies.get('session_id');
  event.locals.user = null;

  // NOTE: `event.platform.env` is the typed Cloudflare Pages/Workers env (via src/app.d.ts).
  const typedEnv = (event.platform?.env ?? null) as unknown as Record<string, unknown> | null;

  if (sessionId && typedEnv) {
    try {
      if (!UUID_V4_REGEX.test(sessionId)) throw new Error('Invalid session id format');

      const sessionsKV = typedEnv['BETA_SESSIONS_KV'];
      if (!isKVWithGet(sessionsKV)) throw new Error('SESSIONS_KV unavailable');

      const sessionRaw = await sessionsKV.get(sessionId);
      if (!sessionRaw) throw new Error('Session not found');

      const parsed = JSON.parse(sessionRaw) as unknown;
      const userId =
        parsed && typeof parsed === 'object'
          ? ((parsed as Record<string, unknown>)['id'] as unknown)
          : undefined;

      if (typeof userId !== 'string' || !UUID_V4_REGEX.test(userId)) {
        throw new Error('Invalid user id in session');
      }

      const usersKV = typedEnv['BETA_USERS_KV'];
      if (!usersKV) throw new Error('USERS_KV unavailable');

      // `KVNamespace` is provided by @cloudflare/workers-types via your project typings.
      const user = await findUserById(usersKV as KVNamespace, userId);

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
    } catch (error: unknown) {
      log.error('[AUTH] Session validation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Fail closed. User remains null.
    }
  }

  // 4) RESPONSE: Security headers + CSP + (optional) CSRF meta tag injection for HTML pages
  const cspDevRelax = envFlag(platformEnv, 'CSP_DEV_RELAX');

  const response = await resolve(
    event,
    csrfToken
      ? {
          transformPageChunk: ({ html }) => {
            const meta = `<meta name="csrf-token" content="${escapeHtmlAttr(csrfToken)}">`;
            if (html.includes('name="csrf-token"')) return html;
            const idx = html.indexOf('</head>');
            if (idx === -1) return html;
            return `${html.slice(0, idx)}${meta}${html.slice(idx)}`;
          }
        }
      : undefined
  );

  // Base security headers
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

  // Content Security Policy (CSP)
  // IMPORTANT: Do NOT set CSP via <meta http-equiv="Content-Security-Policy"> in app.html.
  const scriptSrc = [
    "'self'",
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
    'https://static.cloudflareinsights.com'
  ];

  // In dev, allow inline scripts ONLY if explicitly enabled via CSP_DEV_RELAX=true
  if (dev && cspDevRelax) scriptSrc.push("'unsafe-inline'", "'unsafe-hashes'");

  const connectSrc = [
    "'self'",
    'https://maps.googleapis.com',
    'https://places.googleapis.com',
    'https://cloudflareinsights.com'
  ];

  // Dev tooling often needs websocket + localhost connections
  if (dev) connectSrc.push('ws:', 'http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*');

  const cspDirectives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];

  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // API responses should not be cached by the browser
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
  }

  // Cache-Control headers for static assets
  // - Hashed app assets => 1 year, immutable
  // - Other static assets => 30 days
  try {
    if (event.request.method === 'GET' && response.status === 200) {
      const existing = response.headers.get('cache-control');
      if (!existing) {
        const urlPath = event.url.pathname.toLowerCase();
        const isHtml = urlPath.endsWith('/') || urlPath.endsWith('.html') || urlPath === '/';

        if (!isHtml) {
          const isHashedAsset = urlPath.startsWith('/_app/') || /\.[a-f0-9]{8,}\./.test(urlPath);
          if (isHashedAsset) {
            response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (/\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|json|css|js|woff2?)$/.test(urlPath)) {
            response.headers.set('Cache-Control', 'public, max-age=2592000, immutable');
          }
        } else {
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
