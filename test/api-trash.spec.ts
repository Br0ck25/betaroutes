import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { GET } from '$routes/api/trash/+server';

describe('API /api/trash', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('returns only expenses when type=expenses', async () => {
		const kv = platform.env['BETA_EXPENSES_KV'] as any;
		const userId = 'user-1';
		// Put an expense tombstone
		await kv.put(
			`expense:${userId}:exp-1`,
			JSON.stringify({
				id: 'exp-1',
				userId,
				deleted: true,
				metadata: { deletedAt: new Date().toISOString() },
				backup: { category: 'fuel' }
			})
		);

		// Create fake event
		const url = new URL(`https://example.test/api/trash?type=expenses`);
		const event: any = {
			url,
			platform: { env: platform.env },
			locals: { user: { name: userId } }
		};

		const res = await GET(event as any);
		expect(res.status).toBe(200);
		const body = JSON.parse(await res.text());
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
		expect(body[0].recordType === 'expense' || body[0].id === 'exp-1').toBeTruthy();
	});
});
