// src/lib/utils/keys.ts

/**
 * Check if a record belongs to the current user.
 *
 * MIGRATION COMPATIBILITY: During the migration period, legacy records may have
 * `userId` set to the username (e.g., "James") while the session has the UUID.
 * This function checks ownership against BOTH the UUID and the username.
 *
 * @param recordUserId - The userId stored on the record (may be UUID or username)
 * @param sessionUserId - The user's UUID from the session
 * @param sessionUserName - The user's username/name from the session (optional)
 * @returns true if the record belongs to the user
 */
export function isRecordOwner(
	recordUserId: string | undefined,
	sessionUserId: string,
	sessionUserName?: string
): boolean {
	if (!recordUserId) return false;
	// Match by UUID (new format)
	if (recordUserId === sessionUserId) return true;
	// Match by username (legacy format) - only if username is provided
	if (sessionUserName && recordUserId === sessionUserName) return true;
	return false;
}

export function normalizeSearchString(str: string): string {
	if (!str) return '';
	return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function generatePrefixKey(query: string): string {
	const normalized = normalizeSearchString(query);
	// Bucket by the first 10 characters for autocomplete lists
	const length = Math.min(10, normalized.length);
	const prefix = normalized.substring(0, length);
	return `prefix:${prefix}`;
}

// [!code ++] New: Secure, uniform key generation for Place Details
export async function generatePlaceKey(address: string): Promise<string> {
	const normalized = normalizeSearchString(address);
	const encoder = new TextEncoder();
	const data = encoder.encode(normalized);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return `place:${hashHex}`;
}
