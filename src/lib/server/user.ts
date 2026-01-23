// src/lib/server/user.ts

/**
 * Returns the user's ID for storage keys.
 * SECURITY FIX: Only returns user.id to prevent account takeover vulnerabilities.
 * Never falls back to username or token.
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// SECURITY: Only use user.id, never fallback to name or token
	return user.id || '';
}

/**
 * @deprecated Legacy function used only during Phase 1 migration.
 * Returns username-based storage ID for reading old data.
 * Will be removed once all users have been migrated (Phase 3).
 */
export function getLegacyStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// Return the OLD format for reading legacy data during migration
	return user.name || user.id || user.token || '';
}
