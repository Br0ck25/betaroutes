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

	it('manual miles are preserved when odometers are zero and mirror to trips', async () => {
		const userId = 'u-test';
		// create a millage record with zeroed odometers (common when user chooses manual miles)
		const rec = await millage.create({ startOdometer: 0, endOdometer: 0, miles: 0 }, userId as any);

		// Create a matching trip record so mirroring can be observed
		const db = await getDB();
		await db
			.transaction('trips', 'readwrite')
			.objectStore('trips')
			.put({
				id: rec.id,
				userId,
				totalMiles: 0,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			} as any);

		// User edits miles manually while odometers remain zero
		await millage.updateMillage(
			rec.id,
			{ startOdometer: 0, endOdometer: 0, miles: 20 },
			userId as any
		);

		const got = await millage.get(rec.id, userId as any);
		expect(got).toBeTruthy();
		expect(got?.miles).toBeCloseTo(20, 6);

		const tx = db.transaction('trips', 'readonly');
		const trip = await tx.objectStore('trips').get(rec.id);
		await tx.done;
		expect(trip?.totalMiles).toBeCloseTo(20, 6);
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
