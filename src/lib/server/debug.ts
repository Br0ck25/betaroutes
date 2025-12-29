// src/lib/server/debug.ts
import { dev } from '$app/environment';

export function ensureDebugEnabled(platform?: App.Platform) {
	const env = platform?.env as Record<string, string> | undefined;

	// Allow debug in local dev or when ALLOW_DEBUG_ROUTES is explicitly set
	const enabled =
		dev ||
		env?.['ALLOW_DEBUG_ROUTES'] === '1' ||
		env?.['ALLOW_DEBUG_ROUTES'] === 'true' ||
		process.env['DEBUG_ROUTES'] === '1';

	if (!enabled) throw new Error('Debug routes are disabled');
}

export function isDebugEnabled(platform?: App.Platform) {
	try {
		ensureDebugEnabled(platform);
		return true;
	} catch {
		return false;
	}
}
