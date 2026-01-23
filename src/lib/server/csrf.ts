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
 * SECURITY: This function always takes O(max(a.length, b.length)) time,
 * preventing timing-based information leakage
 */
export function safeCompare(a: string, b: string): boolean {
	// Use constant-time comparison that doesn't leak length
	const maxLen = Math.max(a.length, b.length);

	// Pad both strings to same length to prevent length timing leak
	const paddedA = a.padEnd(maxLen, '\0');
	const paddedB = b.padEnd(maxLen, '\0');

	let result = 0;
	// XOR every character - difference in any character sets result bits
	for (let i = 0; i < maxLen; i++) {
		result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
	}

	// Only return true if all chars matched AND lengths were equal
	return result === 0 && a.length === b.length;
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

	// Skip CSRF for specific endpoints that need exemption
	const skipPaths = [
		'/api/webhooks/stripe',
		'/api/stripe/webhook', // Stripe needs its own signature validation
		'/login', // Login form (no session yet)
		'/register', // Registration (no session yet)
		'/api/forgot-password', // Password reset (no session)
		'/api/reset-password', // Password reset token validation
		'/api/verify', // Email verification token
		'/api/verify/resend' // Resend verification email
	];
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
