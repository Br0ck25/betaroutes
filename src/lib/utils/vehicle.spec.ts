import { describe, it, expect } from 'vitest';
import { getVehicleDisplayName } from './vehicle';

describe('getVehicleDisplayName', () => {
	const vehicles = [
		{ id: 'v-1', name: 'Work Truck' },
		{ id: 'ae49c6b8-1eea-4505-b339-8636fcd972cd', name: 'Personal Car' }
	];

	it('resolves id to name when present', () => {
		expect(getVehicleDisplayName('v-1', vehicles)).toBe('Work Truck');
		expect(getVehicleDisplayName('ae49c6b8-1eea-4505-b339-8636fcd972cd', vehicles)).toBe(
			'Personal Car'
		);
	});

	it('returns provided name unchanged', () => {
		expect(getVehicleDisplayName('My Old Camper', vehicles)).toBe('My Old Camper');
	});

	it('hides unresolved UUIDs as "Unknown vehicle"', () => {
		expect(getVehicleDisplayName('00000000-0000-4000-8000-000000000000', vehicles)).toBe(
			'Unknown vehicle'
		);
	});

	it('returns dash for empty/undefined', () => {
		expect(getVehicleDisplayName('', vehicles)).toBe('-');
		expect(getVehicleDisplayName(undefined, vehicles)).toBe('-');
	});
});
