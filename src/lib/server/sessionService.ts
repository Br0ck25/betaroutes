// src/lib/server/sessionService.ts

import { randomUUID } from 'node:crypto';

// SECURITY (Issue #12): Interface for session data with required userId
interface SessionData {
	id: string; // User ID
	[key: string]: unknown;
}

// Maximum number of sessions to track per user (prevents unbounded list growth)
const MAX_SESSIONS_PER_USER = 10;

export async function createSession(kv: KVNamespace, userData: unknown) {
	const sessionId = randomUUID();
	// Session expires in 7 days (seconds)
	const SESSION_TTL = 60 * 60 * 24 * 7;

	await kv.put(sessionId, JSON.stringify(userData), { expirationTtl: SESSION_TTL });

	// SECURITY (Issue #12): Track session in active_sessions index for logout-all-devices
	const sessionData = userData as SessionData;
	if (sessionData && sessionData.id) {
		const activeSessionsKey = `active_sessions:${sessionData.id}`;
		try {
			const existingRaw = await kv.get(activeSessionsKey);
			let sessions: string[] = [];
			if (existingRaw) {
				sessions = JSON.parse(existingRaw) as string[];
			}

			// Add new session at the front
			sessions.unshift(sessionId);

			// Cap to prevent unbounded growth (older sessions naturally expire)
			if (sessions.length > MAX_SESSIONS_PER_USER) {
				sessions = sessions.slice(0, MAX_SESSIONS_PER_USER);
			}

			await kv.put(activeSessionsKey, JSON.stringify(sessions), { expirationTtl: SESSION_TTL });
		} catch {
			// Non-critical: don't fail login if session tracking fails
		}
	}

	return sessionId;
}

export async function getSession(kv: KVNamespace, sessionId: string) {
	const data = await kv.get(sessionId);
	return data ? JSON.parse(data) : null;
}

export async function deleteSession(kv: KVNamespace, sessionId: string) {
	await kv.delete(sessionId);
}
