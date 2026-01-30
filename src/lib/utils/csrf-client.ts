// src/lib/utils/csrf.ts
//
// CSRF-protected fetch wrapper for client-side requests
// Works with server-side CSRF implementation in hooks.server.ts

/**
 * Get CSRF token from cookie
 * Server sets this as httpOnly cookie
 */
function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === '__csrf_token') {
      return value ?? null;
    }
  }
  return null;
}

/**
 * Fetch with CSRF token automatically added
 * Use this instead of raw fetch() for all state-changing requests
 *
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response promise
 * @throws Error if CSRF token is missing
 */
export async function csrfFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getCsrfToken();

  if (!token) {
    throw new Error('CSRF token not found. Please refresh the page.');
  }

  // Add CSRF token header
  const headers = new Headers(options.headers);
  headers.set('x-csrf-token', token);

  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Check if CSRF token exists
 * Useful for debugging
 */
export function hasCsrfToken(): boolean {
  return getCsrfToken() !== null;
}
