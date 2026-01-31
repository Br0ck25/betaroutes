// src/lib/server/debug.ts
import { dev } from '$app/environment';

export function ensureDebugEnabled(platform?: App.Platform) {
  const env = platform?.env as Record<string, string> | undefined;

  // Allow debug in local dev or when ALLOW_DEBUG_ROUTES or DEBUG_ROUTES is explicitly set via platform.env
  const enabled =
    dev ||
    env?.['ALLOW_DEBUG_ROUTES'] === '1' ||
    env?.['ALLOW_DEBUG_ROUTES'] === 'true' ||
    env?.['DEBUG_ROUTES'] === '1' ||
    env?.['DEBUG_ROUTES'] === 'true';

  if (!enabled) throw new Error('Debug routes are disabled');
}

export function isDebugEnabled(platform?: App.Platform) {
  try {
    ensureDebugEnabled(platform);
    return true;
  } catch {
    return false;
  }
}
