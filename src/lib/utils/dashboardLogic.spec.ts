import { describe, it, expect } from 'vitest';
import { computeMaintenance } from './dashboardLogic';

describe('computeMaintenance', () => {
	it('is visible when within reminder threshold and shows "Due in" message', () => {
		const res = computeMaintenance({
			vehicleOdometerStart: 0,
			totalMilesAllTime: 15000,
			lastServiceOdometer: 10400, // 15000 - 10400 = 4600 miles since service
			serviceIntervalMiles: 5000, // due in 400 miles
			reminderThresholdMiles: 500
		});

		expect(res.visible).toBe(true);
		expect(res.message).toContain('You have driven');
		expect(res.message).toContain('Due in');
		expect(Math.round(res.dueIn)).toBe(400);
	});

	it('is not visible when not within reminder threshold and not overdue', () => {
		const res = computeMaintenance({
			vehicleOdometerStart: 0,
			totalMilesAllTime: 15000,
			lastServiceOdometer: 11000, // 4000 miles since service
			serviceIntervalMiles: 5000, // due in 1000 miles
			reminderThresholdMiles: 500
		});

		expect(res.visible).toBe(false);
		expect(res.message).toContain('You have driven');
		expect(res.message).toContain('Due in');
		expect(Math.round(res.dueIn)).toBe(1000);
	});

	it('is visible when overdue and shows overdue message', () => {
		const res = computeMaintenance({
			vehicleOdometerStart: 0,
			totalMilesAllTime: 15000,
			lastServiceOdometer: 9400, // 5600 miles since service
			serviceIntervalMiles: 5000, // overdue by 600 miles
			reminderThresholdMiles: 500
		});

		expect(res.visible).toBe(true);
		expect(res.message).toContain('Overdue');
		expect(Math.round(res.dueIn)).toBe(-600);
	});
});
