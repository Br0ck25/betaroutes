// src/lib/server/user.ts

/**
 * Normalize a user object into a consistent storage id used for KV keys.
 * Prefer the `name` when available (username), then `id`, then `token`.
 * This ensures KV keys are always based on the human-readable username.
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.name || user.id || user.token || '';
}
