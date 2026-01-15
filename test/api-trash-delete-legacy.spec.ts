import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { DELETE } from '$routes/api/trash/[id]/+server';

describe('/api/trash/[id] DELETE (legacy logs KV)', () => {
	let platform: any;
	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('removes expense key from legacy BETA_LOGS_KV when present', async () => {
		const logsKv = platform.env['BETA_LOGS_KV'];
		const userId = 'legacy_user';
		const id = 'exp-legacy-1';
		// Put an expense (legacy) into logs KV
		await logsKv.put(
			`expense:${userId}:${id}`,
			JSON.stringify({
				id,
				userId,
				category: 'fuel',
				amount: 11,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			})
		);

		const event: any = {
			params: { id },
			platform: { env: platform.env },
			locals: { user: { name: userId } }
		};

		const res = await DELETE(event as any);
		expect(res.status).toBe(204);

		const after = await logsKv.get(`expense:${userId}:${id}`);
		expect(after).toBeNull();
	});
});
