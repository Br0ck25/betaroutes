// src/lib/server/requestValidation.ts
// [SECURITY FIX #51] Request size and content validation to prevent DoS attacks

import { hasDangerousKeys, sanitizeJson } from './sanitize';

const MAX_JSON_SIZE = 1024 * 1024; // 1MB default
const MAX_NESTING_DEPTH = 10;

/**
 * Result type for JSON parsing
 */
export type ParseResult<T = unknown> =
	| { ok: true; data: T }
	| { ok: false; error: string; status: number };

/**
 * Calculate object nesting depth to prevent stack overflow attacks
 */
function getObjectDepth(obj: unknown, currentDepth = 0): number {
	if (currentDepth > MAX_NESTING_DEPTH) return currentDepth;
	if (typeof obj !== 'object' || obj === null) return currentDepth;

	let maxChildDepth = currentDepth;

	if (Array.isArray(obj)) {
		for (const item of obj) {
			if (typeof item === 'object' && item !== null) {
				maxChildDepth = Math.max(maxChildDepth, getObjectDepth(item, currentDepth + 1));
				if (maxChildDepth > MAX_NESTING_DEPTH) break;
			}
		}
	} else {
		for (const value of Object.values(obj)) {
			if (typeof value === 'object' && value !== null) {
				maxChildDepth = Math.max(maxChildDepth, getObjectDepth(value, currentDepth + 1));
				if (maxChildDepth > MAX_NESTING_DEPTH) break;
			}
		}
	}

	return maxChildDepth + 1;
}

/**
 * Safely parse JSON request with size and nesting depth validation
 * Prevents memory exhaustion and stack overflow attacks
 *
 * @param request - The incoming Request object
 * @param maxSize - Maximum allowed payload size in bytes (default 1MB)
 * @returns ParseResult with data or error
 *
 * @example
 * ```typescript
 * const result = await parseJsonSafely(request);
 * if (!result.ok) {
 *   return json({ error: result.error }, { status: result.status });
 * }
 * const body = result.data;
 * ```
 */
export async function parseJsonSafely<T = unknown>(
	request: Request,
	maxSize: number = MAX_JSON_SIZE
): Promise<ParseResult<T>> {
	// 1. Validate Content-Type header
	const contentType = request.headers.get('content-type');
	if (!contentType || !contentType.toLowerCase().includes('application/json')) {
		return {
			ok: false,
			error: 'Content-Type must be application/json',
			status: 415 // Unsupported Media Type
		};
	}

	// 2. Check Content-Length header (if provided)
	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const length = parseInt(contentLength, 10);
		if (isNaN(length) || length > maxSize) {
			return {
				ok: false,
				error: 'Request payload too large',
				status: 413 // Payload Too Large
			};
		}
	}

	// 3. Read request body with size check
	let text: string;
	try {
		text = await request.text();
	} catch {
		return {
			ok: false,
			error: 'Failed to read request body',
			status: 400
		};
	}

	// 4. Verify actual size doesn't exceed limit
	if (text.length > maxSize) {
		return {
			ok: false,
			error: 'Request payload too large',
			status: 413
		};
	}

	// 5. Parse JSON with error handling
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return {
			ok: false,
			error: 'Invalid JSON',
			status: 400
		};
	}

	// 6. Validate object nesting depth
	if (typeof data === 'object' && data !== null) {
		const depth = getObjectDepth(data);
		if (depth > MAX_NESTING_DEPTH) {
			return {
				ok: false,
				error: 'Object nesting too deep',
				status: 400
			};
		}
	}

	// 7. [SECURITY FIX #56] Check for prototype pollution attempts
	if (hasDangerousKeys(data)) {
		return {
			ok: false,
			error: 'Invalid request data',
			status: 400
		};
	}

	// 8. Sanitize JSON to remove any dangerous keys
	data = sanitizeJson(data);

	// 9. Return validated data
	return {
		ok: true,
		data: data as T
	};
}

/**
 * Middleware-style helper for API endpoints
 * Returns Response if validation fails, otherwise returns validated data
 *
 * @example
 * ```typescript
 * export const POST: RequestHandler = async ({ request }) => {
 *   const result = await validateJsonRequest(request);
 *   if (result instanceof Response) return result; // Error response
 *
 *   const body = result; // Validated data
 *   // ... process body
 * };
 * ```
 */
export async function validateJsonRequest<T = unknown>(
	request: Request,
	maxSize?: number
): Promise<T | Response> {
	const result = await parseJsonSafely<T>(request, maxSize);

	if (!result.ok) {
		return new Response(JSON.stringify({ error: result.error }), {
			status: result.status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	return result.data;
}
