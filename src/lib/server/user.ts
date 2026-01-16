// src/lib/server/user.ts

/**
 * Normalize a user object into a consistent storage id used for KV keys.
 * Prefer canonical `id` when available, then `name`, then `token`.
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.id || user.name || user.token || '';
}
