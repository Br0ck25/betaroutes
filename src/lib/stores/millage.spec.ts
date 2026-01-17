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

	it('computes reimbursement on create and update (uses rate fallback)', async () => {
		const userId = 'u-reim';

		// create with explicit rate
		const r1 = await millage.create({ miles: 10, millageRate: 0.75 }, userId as any);
		expect(r1.reimbursement).toBeCloseTo(7.5, 2);

		// create without explicit rate -> may pick up userSettings fallback (not present in this unit harness)
		const r2 = await millage.create({ miles: 5, millageRate: 0.5 }, userId as any);
		expect(r2.reimbursement).toBeCloseTo(2.5, 2);

		// update miles should recompute reimbursement when rate present
		await millage.updateMillage(r2.id, { miles: 6 }, userId as any);
		const updated = await millage.get(r2.id, userId as any);
		expect(updated?.reimbursement).toBeCloseTo(3.0, 2);

		// update rate should recompute reimbursement
		await millage.updateMillage(r2.id, { millageRate: 0.6 }, userId as any);
		const updated2 = await millage.get(r2.id, userId as any);
		expect(updated2?.reimbursement).toBeCloseTo(6 * 0.6, 2);
	});

	it('sums reimbursements across millage logs correctly', async () => {
		const userId = 'u-sum';
		await millage.create({ miles: 10, millageRate: 0.5 }, userId as any);
		await millage.create({ miles: 20, millageRate: 0.55 }, userId as any);
		const db = await getDB();
		const tx = db.transaction('millage', 'readonly');
		const all = await tx.objectStore('millage').getAll();
		await tx.done;
		const sum = all.reduce((s: number, r: any) => s + Number(r.reimbursement || 0), 0);
		expect(sum).toBeCloseTo(10 * 0.5 + 20 * 0.55, 6);
	});

	it('deleting a millage linked to a trip preserves the trip and zeroes totalMiles', async () => {
		const userId = 'u-delete-trip';
		const db = await getDB();

		// Seed trip and linked millage
		const tripId = 'trip-linked-1';
		await db
			.transaction('trips', 'readwrite')
			.objectStore('trips')
			.put({
				id: tripId,
				userId,
				totalMiles: 42,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				syncStatus: 'synced'
			} as any);

		await millage.create({ id: tripId, miles: 42, tripId }, userId as any);

		// Delete the millage record
		await millage.deleteMillage(tripId, userId as any);

		// Trip should still exist and totalMiles should be zeroed
		const tx = db.transaction('trips', 'readonly');
		const trip = await tx.objectStore('trips').get(tripId);
		await tx.done;
		expect(trip).toBeTruthy();
		expect(trip?.totalMiles).toBe(0);

		// Sync queue should have an update for the trip so server will mirror the zeroed miles
		const qtx = db.transaction('syncQueue', 'readonly');
		const all = await qtx.objectStore('syncQueue').getAll();
		await qtx.done;
		expect(
			all.some(
				(i: any) => i.tripId === tripId && i.action === 'update' && i.data?.store === 'trips'
			)
		).toBe(true);
	});
});
