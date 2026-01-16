import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { POST, GET } from '$routes/api/millage/+server';

describe('API /api/millage storage id behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('POST prefers stable user id when present', async () => {
		const kv = platform.env['BETA_MILLAGE_KV'] as any;
		const body = { startOdometer: 100, endOdometer: 150 };

		const event: any = {
			request: { json: async () => body },
			platform: { env: platform.env },
			locals: { user: { id: 'stable-user-1' } }
		};

		const res = await POST(event as any);
		expect(res.status).toBe(201);
		const created = JSON.parse(await res.text());
		expect(created.userId).toBe('stable-user-1');

		const raw = await kv.get(`millage:stable-user-1:${created.id}`);
		expect(raw).toBeTruthy();
	});

	it('GET returns records stored under any known identifier for the user', async () => {
		const kv = platform.env['BETA_MILLAGE_KV'] as any;
		const legacyToken = 'legacy-token-xyz';
		// Simulate a record that was created earlier and keyed to a legacy token
		await kv.put(
			`millage:${legacyToken}:m-1`,
			JSON.stringify({
				id: 'm-1',
				userId: legacyToken,
				miles: 10,
				createdAt: new Date().toISOString()
			})
		);

		// Now call GET as the same logical user but with id and token set to the legacy token
		const url = new URL(`https://example.test/api/millage`);
		const event: any = {
			url,
			platform: { env: platform.env },
			locals: { user: { token: legacyToken } }
		};

		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const body = JSON.parse(await res.text());
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
		expect(body.find((r: any) => r.id === 'm-1')).toBeTruthy();
	});
});
