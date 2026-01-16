import { describe, it, expect } from 'vitest';
import { computeMaintenance, calculateDashboardStats } from './dashboardLogic';

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

describe('calculateDashboardStats - 7d range', () => {
	it('includes trips from the last 7 days and excludes older ones', () => {
		const now = new Date();
		const format = (d: Date) => d.toISOString().split('T')[0];

		const trips = [
			{
				id: 't1',
				date: format(new Date(now)),
				stops: [{ earnings: 100 }],
				fuelCost: 10,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 10
			}, // today
			{
				id: 't2',
				date: format(new Date(now.getTime() - 86400 * 1000)),
				stops: [{ earnings: 200 }],
				fuelCost: 50,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 15
			}, // yesterday
			{
				id: 't3',
				date: format(new Date(now.getTime() - 6 * 86400 * 1000)),
				stops: [{ earnings: 50 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 5
			}, // 6 days ago
			{
				id: 't4',
				date: format(new Date(now.getTime() - 8 * 86400 * 1000)),
				stops: [{ earnings: 500 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 50
			} // 8 days ago (should be excluded)
		];

		const stats = calculateDashboardStats(trips, [], '7d');

		expect(stats.totalTrips).toBe(3);
		expect(stats.recentTrips.find((t: any) => t.id === 't4')).toBeUndefined();
	});
});

describe('calculateDashboardStats - prev-1y range', () => {
	it('includes only trips within the previous calendar year', () => {
		const now = new Date();
		const y = now.getFullYear();
		const prevYearStart = new Date(y - 1, 0, 1);
		const prevYearMid = new Date(y - 1, 6, 1);
		const prevYearEnd = new Date(y - 1, 11, 31);

		const format = (d: Date) => d.toISOString().split('T')[0];

		const trips = [
			{
				id: 'a',
				date: format(prevYearStart),
				stops: [{ earnings: 100 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 10
			},
			{
				id: 'b',
				date: format(prevYearMid),
				stops: [{ earnings: 200 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 20
			},
			{
				id: 'c',
				date: format(prevYearEnd),
				stops: [{ earnings: 300 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 30
			},
			{
				id: 'd',
				date: format(new Date(y, 0, 1)),
				stops: [{ earnings: 400 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				totalMiles: 40
			} // current year
		];

		const stats = calculateDashboardStats(trips, [], 'prev-1y');

		expect(stats.totalTrips).toBe(3);
		expect(stats.recentTrips.find((t: any) => t.id === 'd')).toBeUndefined();
	});
});
