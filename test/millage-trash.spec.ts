import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeMillageService } from '$lib/server/millageService';

describe('Millage trash behavior', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: any = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('delete stores tombstone in main millage KV and sets TTL', async () => {
		const kv = platform.env['BETA_MILLAGE_KV'] as any;
		const svc = makeMillageService(kv, platform.env['TRIP_INDEX_DO'] as any);

		const userId = 'trash_m_user';
		const id = 'm-1';
		const now = new Date().toISOString();
		const record = {
			id,
			userId,
			date: now,
			startOdometer: 100,
			endOdometer: 110,
			miles: 10,
			createdAt: now,
			updatedAt: now
		};

		await kv.put(`millage:${userId}:${id}`, JSON.stringify(record));

		await svc.delete(userId, id);

		const raw = await kv.get(`millage:${userId}:${id}`);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw);
		expect(parsed.deleted).toBe(true);
		expect(parsed.backup?.id === id).toBeTruthy();
		expect(parsed.metadata?.expiresAt).toBeTruthy();

		const list = await svc.listTrash(userId);
		expect(list.length).toBeGreaterThan(0);
		const found = list.find((t) => t.id === id);
		expect(found).toBeTruthy();
		expect(found?.miles).toBe(10);

		// Restore
		await svc.restore(userId, id);
		const after = JSON.parse(await kv.get(`millage:${userId}:${id}`));
		expect(after.deleted).toBe(undefined);
		expect(after.miles).toBe(10);
	});
});
