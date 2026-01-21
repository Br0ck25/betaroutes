// src/lib/server/csrf.ts
// [!code fix] SECURITY (Issue #4): CSRF protection for API endpoints

import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Generate a CSRF token and store it in httpOnly cookie + readable cookie
 * Call this in hooks.server.ts for every request
 * Uses double-submit cookie pattern
 */
export function generateCsrfToken(event: RequestEvent): string {
	// Check if token already exists
	let token = event.cookies.get('csrf_token');

	if (!token) {
		token = randomUUID();
		// HttpOnly cookie for validation
		event.cookies.set('csrf_token', token, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});

		// Readable cookie for client to include in headers
		event.cookies.set('csrf_token_readable', token, {
			path: '/',
			httpOnly: false, // Client can read this
			secure: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});
	}

	return token;
}

/**
 * Validate CSRF token for state-changing requests
 * Call this for POST/PUT/DELETE/PATCH requests in API endpoints
 */
export function validateCsrfToken(event: RequestEvent): boolean {
	const cookieToken = event.cookies.get('csrf_token');
	const headerToken =
		event.request.headers.get('x-csrf-token') || event.request.headers.get('X-CSRF-Token');

	// Both tokens must exist and match
	if (!cookieToken || !headerToken) {
		return false;
	}

	// Timing-safe comparison
	return safeCompare(cookieToken, headerToken);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}

	return result === 0;
}

/**
 * Middleware to check CSRF token for API endpoints
 * Returns error response if validation fails
 */
export function csrfProtection(event: RequestEvent): Response | null {
	const method = event.request.method;
	const url = event.url.pathname;

	// Only validate state-changing methods
	if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
		return null;
	}

	// Skip CSRF for specific endpoints that need it (e.g., Stripe webhooks)
	const skipPaths = ['/api/webhooks/stripe'];
	if (skipPaths.some((path) => url.startsWith(path))) {
		return null;
	}

	// Validate token
	if (!validateCsrfToken(event)) {
		return new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return null;
}
