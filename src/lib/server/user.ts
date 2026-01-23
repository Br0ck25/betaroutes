// src/lib/server/user.ts

/**
 * Get the storage ID for a user - MUST be the user's UUID.
 * SECURITY (Issue #1): NEVER fall back to name or token.
 * Using name/token as storage keys enables Account Takeover attacks
 * where attacker data can overwrite victim data.
 *
 * @returns The user's UUID or empty string if not available
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	// SECURITY: Only return the user's UUID, never name or token
	return user?.id || '';
}
