// src/lib/utils/csrf.ts
// [!code fix] SECURITY (Issue #4): Client-side CSRF token handling

/**
 * Get CSRF token from readable cookie
 * The server sets both csrf_token (httpOnly) and csrf_token_readable (readable)
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf_token_readable' && value) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

/**
 * Create headers with CSRF token included
 * Use this to add CSRF token to existing headers
 */
export function withCsrfToken(headers: HeadersInit = {}): Headers {
  const headersObj = new Headers(headers);
  const token = getCsrfToken();
  if (token) {
    headersObj.set('X-CSRF-Token', token);
  }
  return headersObj;
}

/**
 * Add CSRF token to fetch headers
 * Use this to wrap fetch calls that perform state-changing operations
 */
export function addCsrfHeader(headers: HeadersInit = {}): HeadersInit {
  const token = getCsrfToken();
  if (!token) {
    // Silently return headers if no token found
    return headers;
  }

  // Convert headers to Headers object to easily add token
  const headersObj = new Headers(headers);
  headersObj.set('X-CSRF-Token', token);

  return headersObj;
}

/**
 * Wrapper for fetch that automatically includes CSRF token
 * Use this for all POST/PUT/DELETE/PATCH requests
 */
export async function csrfFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const method = options.method?.toUpperCase() || 'GET';

  // Only add CSRF token for state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    options.headers = addCsrfHeader(options.headers);
  }

  // Always include credentials for same-origin requests
  if (!options.credentials) {
    options.credentials = 'same-origin';
  }

  return fetch(url, options);
}

/**
 * Helper to create common fetch options with CSRF token
 * For JSON API calls
 */
export function jsonFetchOptions(
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  body: unknown
): RequestInit {
  return {
    method,
    headers: withCsrfToken({
      'Content-Type': 'application/json'
    }),
    credentials: 'same-origin',
    body: JSON.stringify(body)
  };
}
