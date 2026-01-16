import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDB, clearDatabase } from '$lib/db/indexedDB';
import { millage } from './millage';

describe('Millage store (IndexedDB)', () => {
	beforeEach(async () => {
		await clearDatabase();
	});

	it('creates a millage record without throwing', async () => {
		const userId = 'test-user';
		const data = { startOdometer: 100, endOdometer: 150 };

		const record = await millage.create(data, userId as any);

		expect(record).toHaveProperty('id');
		expect(record.userId).toBe(userId);
		expect(record.miles).toBe(50);

		const db = await getDB();
		const tx = db.transaction('millage', 'readonly');
		const stored = await tx.objectStore('millage').get(record.id);
		await tx.done;

		expect(stored).toBeTruthy();
		expect(stored.userId).toBe(userId);
	});

	it('preserves miles when updating non-mile fields', async () => {
		const userId = 'u1';
		const r = await millage.create(
			{ startOdometer: 100, endOdometer: 160, miles: 60 },
			userId as any
		);

		// Update only notes (no miles/odometers provided)
		await millage.updateMillage(r.id, { notes: 'updated' }, userId as any);

		const updated = await millage.get(r.id, userId as any);
		expect(updated).toBeTruthy();
		expect(updated?.miles).toBe(60);
	});

	it('respects explicit miles when odometer fields are present but miles provided', async () => {
		const userId = 'u2';
		const r = await millage.create({ startOdometer: 0, endOdometer: 0, miles: 10 }, userId as any);

		// Simulate save that includes odometers (0) but also explicitly sets miles to 42
		await millage.updateMillage(
			r.id,
			{ startOdometer: 0, endOdometer: 0, miles: 42 },
			userId as any
		);

		const updated = await millage.get(r.id, userId as any);
		expect(updated).toBeTruthy();
		expect(updated?.miles).toBe(42);
	});
});
