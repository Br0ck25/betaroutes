// src/lib/server/user.ts

/**
 * Normalize a user object into a consistent storage id used for KV keys.
 * STRICTLY uses the `id` to prevent Account Takeover (ATO) attacks via username spoofing.
 */
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	// [!code fix] strictly return ID or empty string. never fallback to mutable fields.
	return user?.id || '';
}
