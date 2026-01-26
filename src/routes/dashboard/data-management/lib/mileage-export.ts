// Mileage export utility functions for data-management page

import type { MileageRecord } from '$lib/db/types';

/** Row produced by CSV import - partial MileageRecord with required id */
export interface ImportMileageRow {
	id: string;
	date: string;
	vehicle?: string;
	startOdometer?: number;
	endOdometer?: number;
	miles: number;
	purpose?: string;
	notes?: string;
}

export function exportMileageCSV(
	mileageRecords: MileageRecord[],
	selectedIds: Set<string>,
	includeSummary: boolean,
	formatDate: (date: string) => string,
	formatCurrency: (amount: number) => string
): string {
	const mileageToExport = mileageRecords.filter(
		(m) => typeof m.id === 'string' && selectedIds.has(m.id)
	);

	if (mileageToExport.length === 0) {
		throw new Error('Please select at least one mileage log to export');
	}

	let csv = 'Date,Vehicle,Start Odometer,End Odometer,Miles,Purpose,Notes\n';

	let totalMiles = 0;

	mileageToExport.forEach((m) => {
		const miles = Number(m.miles || 0);
		totalMiles += miles;

		const row = [
			formatDate(m.date || ''),
			`"${m.vehicle || 'Default'}"`,
			String(m.startOdometer ?? ''),
			String(m.endOdometer ?? ''),
			miles.toFixed(2),
			`"${(m['purpose'] as string) || 'Business'}"`,
			`"${(m['notes'] as string) || ''}"`
		];

		csv += row.join(',') + '\n';
	});

	if (includeSummary) {
		csv += '\n';
		csv += 'SUMMARY\n';
		csv += `Total Logs,${mileageToExport.length}\n`;
		csv += `Total Miles,${totalMiles.toFixed(2)}\n`;
		csv += `Standard Mileage Rate (2026),$0.725\n`;
		csv += `Est. Deduction,${formatCurrency(totalMiles * 0.725)}\n`;
	}

	return csv;
}

export function parseMileageCSV(csvText: string): ImportMileageRow[] {
	const lines = csvText.split('\n').filter((line) => line.trim());

	if (lines.length < 2) {
		throw new Error('CSV file must have header and at least one data row');
	}

	// Enforce a max row cap to avoid huge imports
	const MAX_ROWS = 5000;
	const dataLines = lines.slice(1, 1 + MAX_ROWS);
	if (lines.length > MAX_ROWS + 1) {
		throw new Error(`CSV file too large. Limit is ${MAX_ROWS} rows`);
	}

	const now = Date.now();
	const mileageLogs: ImportMileageRow[] = dataLines.map((line, idx) => {
		const [date, vehicle, startOdometer, endOdometer, miles, purpose, notes] = line.split(',');

		return {
			id: `import-${now}-${idx}`,
			date: String(date?.trim() || new Date().toISOString().split('T')[0]),
			vehicle: String(vehicle?.replace(/"/g, '').trim() || 'Default'),
			startOdometer: Number(startOdometer?.trim()) || 0,
			endOdometer: Number(endOdometer?.trim()) || 0,
			miles: Number(miles?.trim()) || 0,
			purpose: String(purpose?.replace(/"/g, '').trim() || 'Business'),
			notes: String(notes?.replace(/"/g, '').trim() || '')
		};
	});

	return mileageLogs;
}
