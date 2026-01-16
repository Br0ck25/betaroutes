import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase, getDB } from '$lib/db/indexedDB';
import { trips } from './trips';
import { millage } from './millage';

describe('Trips <-> Millage integration', () => {
	beforeEach(async () => {
		await clearDatabase();
	});

	it('creating a trip also creates a linked millage record', async () => {
		const userId = 'u-test';
		const trip = await trips.create({ date: '2025-01-01', totalMiles: 42 }, userId as any);

		// Millage record should be created with the same id
		const m = await millage.get(trip.id, userId as any);
		expect(m).toBeTruthy();
		expect(m?.miles).toBe(42);
		expect((m as any).tripId).toBe(trip.id);

		// DB has millage
		const db = await getDB();
		const tx = db.transaction('millage', 'readonly');
		const stored = await tx.objectStore('millage').get(trip.id);
		await tx.done;
		expect(stored).toBeTruthy();
	});

	it('updating millage reflects on the trip totalMiles', async () => {
		const userId = 'u-test';
		const trip = await trips.create({ date: '2025-01-02', totalMiles: 10 }, userId as any);

		// Update millage record
		await millage.updateMillage(trip.id, { miles: 123 }, userId as any);

		// Trip should have totalMiles updated
		const updatedTrip = await trips.get(trip.id, userId as any);
		expect(updatedTrip).toBeTruthy();
		expect((updatedTrip as any).totalMiles).toBe(123);
	});
});
