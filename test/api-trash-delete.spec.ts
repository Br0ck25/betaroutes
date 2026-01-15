import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { DELETE } from '$routes/api/trash/[id]/+server';

describe('/api/trash/[id] DELETE', () => {
	let platform: any;
	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('permanently deletes expense tombstone from KV', async () => {
		const kv = platform.env['BETA_EXPENSES_KV'];
		const userId = 'del_user';
		const id = 'exp-del-1';
		// Put a tombstone
		await kv.put(
			`expense:${userId}:${id}`,
			JSON.stringify({
				id,
				userId,
				deleted: true,
				metadata: { deletedAt: new Date().toISOString() },
				backup: { id, userId, category: 'fuel' }
			})
		);

		const event: any = {
			params: { id },
			platform: { env: platform.env },
			locals: { user: { name: userId } }
		};

		const res = await DELETE(event as any);
		expect(res.status).toBe(204);

		const after = await kv.get(`expense:${userId}:${id}`);
		expect(after).toBeNull();
	});
});
