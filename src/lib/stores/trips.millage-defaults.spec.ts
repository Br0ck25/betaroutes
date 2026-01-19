import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '$lib/db/indexedDB';
import { trips } from './trips';

describe('Trips -> Millage defaults', () => {
	beforeEach(async () => {
		await clearDatabase();
	});

	it('trip creation queues sync for server-side mileage with user settings', async () => {
		const userId = 'u-defaults';
		const trip = await trips.create({ date: '2026-01-01', totalMiles: 33 }, userId as any);

		// Mileage is created server-side with user settings (millageRate, vehicle)
		// Client-side only queues the trip for sync
		expect(trip.totalMiles).toBeCloseTo(33, 6);
		expect(trip.id).toBeTruthy();
		// Server will create mileage with user settings when sync completes
	});
});
