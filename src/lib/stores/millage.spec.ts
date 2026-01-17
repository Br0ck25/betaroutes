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

	it("editing a non-odometer field doesn't zero the miles", async () => {
		const userId = 'u-test';
		const rec = await millage.create({ miles: 42, date: '2025-01-01' }, userId as any);

		// Edit only notes — miles must remain unchanged
		await millage.updateMillage(rec.id, { notes: 'updated note' }, userId as any);

		const got = await millage.get(rec.id, userId as any);
		expect(got).toBeTruthy();
		expect(got?.miles).toBeCloseTo(42, 6);
	});

	it('updating odometers recalculates miles', async () => {
		const userId = 'u-test';
		const rec = await millage.create({ startOdometer: 100, endOdometer: 110 }, userId as any);
		expect(rec.miles).toBeCloseTo(10, 6);

		await millage.updateMillage(rec.id, { startOdometer: 200, endOdometer: 350 }, userId as any);
		const got = await millage.get(rec.id, userId as any);
		expect(got?.miles).toBeCloseTo(150, 6);
	});
});
