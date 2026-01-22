// src/lib/server/rateLimit.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import type { RateLimitData, User } from '$lib/types';
import { log } from '$lib/server/log';

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt?: Date;
	limit?: number;
}

/**
 * Basic rate limit check (existing function - kept for backwards compatibility)
 */
export async function checkRateLimit(
	kv: KVNamespace,
	ip: string,
	action: string,
	limit: number = 5,
	windowSeconds: number = 60
): Promise<{ allowed: boolean; remaining: number }> {
	const key = `ratelimit:${action}:${ip}`;

	// Get current count
	const currentRaw = await kv.get(key);
	const current = currentRaw ? parseInt(currentRaw) : 0;

	if (current >= limit) {
		return { allowed: false, remaining: 0 };
	}

	// Increment
	// Ensure minimum TTL (Cloudflare requires >= 60s in some environments)
	const ttl = Math.max(60, windowSeconds);
	// We set expirationTtl so the block clears automatically
	await kv.put(key, (current + 1).toString(), { expirationTtl: ttl });

	return { allowed: true, remaining: limit - (current + 1) };
}

/**
 * Enhanced rate limiter with sliding window and detailed response
 */
export async function checkRateLimitEnhanced(
	kv: KVNamespace,
	identifier: string,
	action: string,
	limit: number = 10,
	windowMs: number = 60000 // 1 minute default
): Promise<RateLimitResult> {
	const key = `ratelimit:${action}:${identifier}`;
	const now = Date.now();
	const windowStart = now - windowMs;

	try {
		// Get current rate limit data
		const data = await kv.get<RateLimitData>(key, 'json');

		// Check if window has expired or this is first request
		if (!data || data.windowStart < windowStart) {
			// Start new window
			// Ensure minimum TTL (Cloudflare requires >= 60s in some environments)
			const initialTtl = Math.max(60, Math.ceil(windowMs / 1000));
			await kv.put(
				key,
				JSON.stringify({
					count: 1,
					windowStart: now
				}),
				{
					expirationTtl: initialTtl
				}
			);

			return {
				allowed: true,
				remaining: limit - 1,
				resetAt: new Date(now + windowMs),
				limit
			};
		}

		// Check if limit exceeded
		if (data.count >= limit) {
			return {
				allowed: false,
				remaining: 0,
				resetAt: new Date(data.windowStart + windowMs),
				limit
			};
		}

		// Increment count
		const newCount = data.count + 1;
		const remainingTtl = Math.max(60, Math.ceil((data.windowStart + windowMs - now) / 1000));
		await kv.put(
			key,
			JSON.stringify({
				count: newCount,
				windowStart: data.windowStart
			}),
			{
				expirationTtl: remainingTtl
			}
		);

		return {
			allowed: true,
			remaining: limit - newCount,
			resetAt: new Date(data.windowStart + windowMs),
			limit
		};
	} catch (error) {
		log.error('Rate limit check failed:', error);
		// On error, allow the request (fail open)
		return {
			allowed: true,
			remaining: limit - 1,
			resetAt: new Date(now + windowMs),
			limit
		};
	}
}

/**
 * Create rate limit headers for HTTP responses
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
	const headers: Record<string, string> = {};

	if (result.limit !== undefined) {
		headers['X-RateLimit-Limit'] = result.limit.toString();
	}

	headers['X-RateLimit-Remaining'] = result.remaining.toString();

	if (result.resetAt) {
		headers['X-RateLimit-Reset'] = Math.ceil(result.resetAt.getTime() / 1000).toString();
		headers['Retry-After'] = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000).toString();
	}

	return headers;
}

/**
 * Helper to get client identifier from request
 * Priority: User ID > Session Token > IP Address
 */
export function getClientIdentifier(
	request: Request,
	locals?: { user?: Partial<User> | null }
): string {
	// [!code fix] Issue #38: Only use user ID (not name) - name could be spoofable
	// Prefer user ID if authenticated
	if (locals?.user?.id) {
		return `user:${locals.user.id}`;
	}

	// Fall back to IP address (don't use name or session token as identifiers)
	const cfConnectingIp = request.headers.get('cf-connecting-ip');
	const xForwardedFor = request.headers.get('x-forwarded-for');
	const xRealIp = request.headers.get('x-real-ip');

	const ip = cfConnectingIp || xForwardedFor?.split(',')[0]?.trim() || xRealIp || 'unknown';

	return `ip:${ip}`;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(locals?: { user?: Partial<User> | null }): boolean {
	return !!(locals?.user?.id || locals?.user?.token || locals?.user?.name);
}

/**
 * Predefined rate limit configurations
 */
export const RATE_LIMITS = {
	// Autocomplete: More permissive for better UX
	AUTOCOMPLETE_ANON: { limit: 40, windowMs: 60000 }, // 20 req/min
	AUTOCOMPLETE_AUTH: { limit: 120, windowMs: 60000 }, // 60 req/min

	// Trip API: Standard limits
	TRIPS_ANON: { limit: 20, windowMs: 60000 }, // 10 req/min
	TRIPS_AUTH: { limit: 200, windowMs: 60000 }, // 100 req/min

	// Strict limits for expensive operations
	STRICT: { limit: 5, windowMs: 60000 } // 5 req/min
};
