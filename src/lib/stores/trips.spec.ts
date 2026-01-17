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

	it('normalizes stops on create & update (ids, address, earnings)', async () => {
		const userId = 'u-normalize';
		const raw = {
			date: '2025-03-01',
			stops: [
				{ address: undefined, earnings: '12.5' as any },
				{
					/* missing id/address */
				}
			]
		};
		const created = await trips.create(raw as any, userId as any);
		expect(created.stops).toBeDefined();
		const stops = (created.stops ?? []) as NonNullable<typeof created.stops>;
		if (stops.length < 2) throw new Error('expected 2 stops');
		expect(stops.length).toBe(2);
		const s0 = stops[0]!;
		const s1 = stops[1]!;
		expect(s0).toBeDefined();
		expect(s0.id).toBeTruthy();
		expect(s0.address).toBe('');
		expect(s0.earnings).toBe(12.5);
		expect(s1).toBeDefined();
		expect(s1.id).toBeTruthy();
		expect(s1.address).toBe('');
		// Update with partial stop and ensure normalization persists
		await trips.updateTrip(
			created.id,
			{ stops: [{ id: s0.id, address: s0.address, earnings: '7' as any, order: 0 }] },
			userId as any
		);
		const updated = await trips.get(created.id, userId as any);
		expect(updated?.stops?.[0].earnings).toBe(7);
	});
});
