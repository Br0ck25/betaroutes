import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { createTripForDate } from './tripBuilder';

describe('createTripForDate wifi pay', () => {
	let platform: { env: Record<string, unknown> };
	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event as any);
		platform = event.platform;
	});

	it('adds wifiExtenderPay to stops when order.hasWifiExtender', async () => {
		const settingsKV = platform.env['BETA_USER_SETTINGS_KV'] as any;
		// Ensure settings entry exists (not strictly required for this test)
		await settingsKV.put('settings:testuser', JSON.stringify({ settings: {} }));

		const captured: any[] = [];
		const tripService = {
			put: async (t: any) => {
				captured.push(t);
			}
		};

		const now = Date.now();
		const orders = [
			{
				id: '1',
				address: '1 Test',
				city: 'X',
				state: 'Y',
				zip: '00000',
				confirmScheduleDate: '01/01/2026',
				beginTime: '09:00',
				arrivalTimestamp: now,
				departureCompleteTimestamp: now + 60 * 60000,
				type: 'Install',
				hasWifiExtender: true
			}
		];

		const ok = await createTripForDate(
			'testuser',
			'01/01/2026',
			orders as any,
			'testuser',
			100, // installPay
			50, // repairPay
			50, // upgradePay
			0, // poleCost
			0, // concreteCost
			0, // poleCharge
			15, // wifiExtenderPay
			0, // voipPay
			0, // driveTimeBonus
			tripService,
			settingsKV,
			{ getRouteInfo: async () => ({ duration: 0, distance: 0 }) },
			(msg) => {
				void msg;
				/* logger */
			}
		);

		expect(ok).toBe(true);
		expect(captured.length).toBe(1);
		const trip = captured[0];
		expect(trip.totalEarnings).toBeGreaterThanOrEqual(15);
		expect(trip.stops[0].notes).toContain('[WIFI: $15]');
	});
});
