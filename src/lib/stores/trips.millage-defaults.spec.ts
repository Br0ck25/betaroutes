import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase, getDB } from '$lib/db/indexedDB';
import { trips } from './trips';
import { millage } from './millage';
import { userSettings } from '$lib/stores/userSettings';

describe('Trips -> Millage defaults', () => {
	beforeEach(async () => {
		await clearDatabase();
		userSettings.set({ millageRate: 0.55, vehicles: [{ id: 'v-x', name: 'Test Car' }] } as any);
	});

	it('creates linked millage with millageRate and vehicle from userSettings', async () => {
		const userId = 'u-defaults';
		const trip = await trips.create({ date: '2026-01-01', totalMiles: 33 }, userId as any);

		const m = await millage.get(trip.id, userId as any);
		expect(m).toBeTruthy();
		expect(m?.miles).toBeCloseTo(33, 6);
		expect(m?.millageRate).toBeCloseTo(0.55, 6);
		expect(m?.vehicle).toBe('v-x');

		// ensure DB-stored record also contains the defaults
		const db = await getDB();
		const tx = db.transaction('millage', 'readonly');
		const stored = await tx.objectStore('millage').get(trip.id);
		await tx.done;
		expect(stored.millageRate).toBeCloseTo(0.55, 6);
		expect(stored.vehicle).toBe('v-x');
	});
});