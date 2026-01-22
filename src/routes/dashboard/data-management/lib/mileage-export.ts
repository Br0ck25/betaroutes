// Mileage export utility functions for data-management page

/**
 * [!code fix] Escape CSV field to prevent CSV injection attacks.
 * Prefixes cells starting with =, +, -, @, tab, or CR with a single quote.
 * This prevents Excel/Sheets from interpreting formulas.
 */
function escapeCSVField(value: string | number): string {
	const str = String(value ?? '');
	// Escape internal quotes by doubling them
	const escaped = str.replace(/"/g, '""');
	// Check for formula injection characters
	const firstChar = escaped.charAt(0);
	if (
		firstChar === '=' ||
		firstChar === '+' ||
		firstChar === '-' ||
		firstChar === '@' ||
		firstChar === '\t' ||
		firstChar === '\r'
	) {
		return `"'${escaped}"`;
	}
	return `"${escaped}"`;
}

export function exportMileageCSV(
	mileageRecords: any[],
	selectedIds: Set<string>,
	includeSummary: boolean,
	formatDate: (date: string) => string,
	formatCurrency: (amount: number) => string
): string {
	const mileageToExport = mileageRecords.filter((m) => selectedIds.has(m.id));

	if (mileageToExport.length === 0) {
		throw new Error('Please select at least one mileage log to export');
	}

	let csv = 'Date,Vehicle,Start Odometer,End Odometer,Miles,Purpose,Notes\n';

	let totalMiles = 0;

	mileageToExport.forEach((m) => {
		const miles = Number(m.miles || 0);
		totalMiles += miles;

		// [!code fix] Use escapeCSVField for all user-controlled values
		const row = [
			escapeCSVField(formatDate(m.date || '')),
			escapeCSVField(m.vehicle || 'Default'),
			escapeCSVField(m.startOdometer || ''),
			escapeCSVField(m.endOdometer || ''),
			escapeCSVField(miles.toFixed(2)),
			escapeCSVField(m.purpose || 'Business'),
			escapeCSVField(m.notes || '')
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

export function parseMileageCSV(csvText: string): any[] {
	const lines = csvText.split('\n').filter((line) => line.trim());

	if (lines.length < 2) {
		throw new Error('CSV file must have header and at least one data row');
	}

	const mileageLogs = lines.slice(1).map((line, idx) => {
		const [date, vehicle, startOdometer, endOdometer, miles, purpose, notes] = line.split(',');
		return {
			id: `import-${Date.now()}-${idx}`,
			date: date?.trim() || new Date().toISOString().split('T')[0],
			vehicle: vehicle?.replace(/"/g, '').trim() || 'Default',
			startOdometer: Number(startOdometer?.trim()) || 0,
			endOdometer: Number(endOdometer?.trim()) || 0,
			miles: Number(miles?.trim()) || 0,
			purpose: purpose?.replace(/"/g, '').trim() || 'Business',
			notes: notes?.replace(/"/g, '').trim() || ''
		};
	});

	return mileageLogs;
}
