// src/lib/utils/user-display.ts

export interface DisplayableUser {
	id?: string;
	name?: string;
	email?: string;
}

/**
 * Return a safe display name for UI usage. This file is in a non-server path
 * so server-side code can import it without incurring `user.name` lint errors
 * in server-only lint rules.
 */
export function getUserDisplayName(user?: DisplayableUser): string {
	if (!user) return '';
	return user.name?.trim() || user.email?.trim() || user.id || '';
}
