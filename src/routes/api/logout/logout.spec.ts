import { describe, it, expect, vi } from 'vitest';
import { POST } from './+server';

function makeMockKV(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	return {
		get: async (k: string) => store.get(k),
		put: async (k: string, v: string) => store.set(k, v),
		delete: async (k: string) => store.delete(k)
	};
}

describe('/api/logout', () => {
	it('cleans up session and active_sessions index', async () => {
		const sessionId = 'sess-1';
		const sessionObj = { id: 'u1', token: sessionId };

		const sessionsKV = makeMockKV({
			[sessionId]: JSON.stringify(sessionObj),
			['active_sessions:u1']: JSON.stringify([sessionId, 'sess-2'])
		});

		const cookies = {
			get: (_: string) => sessionId,
			delete: vi.fn()
		};

		const event = {
			cookies,
			platform: { env: { BETA_SESSIONS_KV: sessionsKV } }
		} as unknown as Parameters<typeof POST>[0];

		// POST throws a redirect; capture it
		let thrown: { status?: number } | null = null;
		try {
			await POST(event);
		} catch (t) {
			thrown = t as { status?: number };
		}

		expect(thrown).toBeTruthy();
		expect(thrown?.status).toBe(302);

		// session record removed
		const after = await sessionsKV.get(sessionId);
		expect(after).toBeUndefined();

		// active_sessions updated
		const activeRaw = await sessionsKV.get('active_sessions:u1');
		expect(activeRaw).toBeTruthy();
		const arr = JSON.parse(activeRaw as string) as string[];
		expect(arr).not.toContain(sessionId);

		expect(cookies.delete).toHaveBeenCalledWith('session_id', { path: '/' });
	});
});
