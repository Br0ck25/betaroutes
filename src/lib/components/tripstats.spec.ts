/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import TripStats from '../../routes/dashboard/trips/components/TripStats.svelte';
import { mileage } from '$lib/stores/mileage';
import type { MileageRecord } from '$lib/db/types';

describe('TripStats component', () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		document.body.innerHTML = '';
		container = document.createElement('div');
		document.body.appendChild(container);
		// Reset mileage store
		void mileage.hydrate([]);
	});

	it('calculates total miles using authoritative mileage when present', async () => {
		const trips = [
			{ id: 't1', totalMiles: 10, stops: [], hoursWorked: 1 },
			{ id: 't2', totalMiles: 20, stops: [], hoursWorked: 1 }
		];

		// Provide authoritative mileage for t1
		mileage.updateLocal({ id: 't1', miles: 50, userId: 'test' } as MileageRecord);

		new TripStats({ target: container, props: { trips } });

		const cards = container.querySelectorAll('.summary-card');
		const totalMilesValue = cards[1]?.querySelector('.summary-value')?.textContent ?? '';
		expect(totalMilesValue).toContain('70.00'); // 50 (override) + 20
	});

	it('handles zero hours worked gracefully (no NaN/Infinity)', () => {
		const trips = [{ id: 't3', totalMiles: 5, stops: [], hoursWorked: 0 }];
		new TripStats({ target: container, props: { trips } });
		const cards = container.querySelectorAll('.summary-card');
		const avgValue = cards[3]?.querySelector('.summary-value')?.textContent ?? '';
		expect(avgValue).toContain('N/A');
		expect(avgValue).not.toMatch(/NaN|Infinity/);
	});

	it('formats total profit and hourly rate correctly', () => {
		const trips = [
			{
				id: 't4',
				stops: [{ earnings: 50 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				hoursWorked: 2
			},
			{
				id: 't5',
				stops: [{ earnings: 25 }],
				fuelCost: 0,
				maintenanceCost: 0,
				suppliesCost: 0,
				hoursWorked: 1
			}
		];
		new TripStats({ target: container, props: { trips } });
		const cards = container.querySelectorAll('.summary-card');
		const totalProfit = cards[2]?.querySelector('.summary-value')?.textContent ?? '';
		const avgValue = cards[3]?.querySelector('.summary-value')?.textContent ?? '';

		expect(totalProfit).toContain('$75.00'); // 50 + 25
		expect(avgValue).toContain('$25.00/hr'); // hourly pays: 25, 25 => avg 25
	});
});
