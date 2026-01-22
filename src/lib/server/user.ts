// src/lib/server/user.ts

/**
 * Normalize a user object into a consistent storage id used for KV keys.
 * SECURITY: Strictly return only the user's unique ID.
 * Never fallback to name or token - this prevents account takeover vulnerabilities.
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	return user?.id || '';
}
