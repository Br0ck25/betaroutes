// src/lib/server/sessionService.ts
import type { KVNamespace } from '@cloudflare/workers-types';
import { randomUUID } from 'node:crypto';

export async function createSession(kv: KVNamespace, userData: unknown) {
	const sessionId = randomUUID();
	// Session expires in 7 days (seconds)
	const SESSION_TTL = 60 * 60 * 24 * 7;

	await kv.put(sessionId, JSON.stringify(userData), { expirationTtl: SESSION_TTL });
	return sessionId;
}

export async function getSession(kv: KVNamespace, sessionId: string) {
	const data = await kv.get(sessionId);
	return data ? JSON.parse(data) : null;
}

export async function deleteSession(kv: KVNamespace, sessionId: string) {
	await kv.delete(sessionId);
}
