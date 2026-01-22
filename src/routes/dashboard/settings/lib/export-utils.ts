// Lazy-load heavy PDF libs only when needed to avoid inflating the initial bundle

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

// Helper functions
export function formatCurrency(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

export function formatDuration(minutes: number): string {
	if (!minutes) return '0m';
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function formatDate(dateStr: string): string {
	if (!dateStr) return '';
	const date = new Date(dateStr);
	return date.toLocaleDateString();
}

export async function getLogoDataUrl(): Promise<string | null> {
	try {
		const response = await fetch('/180x75.avif');
		if (!response.ok) return null;
		const blob = await response.blob();
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => resolve(reader.result as string);
			reader.readAsDataURL(blob);
		});
	} catch (e) {
		console.warn('Could not load logo for PDF', e);
		return null;
	}
}

// Export Functions
export function generateTripsCSV(trips: any[], includeSummary: boolean = true): string | null {
	if (trips.length === 0) return null;

	const headers = [
		'Date',
		'Start Address',
		'Intermediate Stops',
		'End Address',
		'Total Miles',
		'Drive Time',
		'Hours Worked',
		'Hourly Pay ($/hr)',
		'Total Revenue',
		'Fuel Cost',
		'Maintenance Cost',
		'Maintenance Items',
		'Supply Cost',
		'Supply Items',
		'Total Expenses',
		'Net Profit',
		'Notes'
	];

	const rows = trips.map((trip) => {
		const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';

		// [!code fix] Use escapeCSVField for all user-controlled values
		const intermediateStops =
			trip.stops && trip.stops.length > 0
				? trip.stops.map((s: any) => `${s.address} ($${(s.earnings || 0).toFixed(2)})`).join(' | ')
				: '';

		const rawEnd =
			trip.endAddress ||
			(trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
			trip.startAddress;

		const revenue =
			trip.stops?.reduce((sum: number, stop: any) => sum + (stop.earnings || 0), 0) || 0;
		const fuel = trip.fuelCost || 0;

		const maint = trip.maintenanceCost || 0;
		const maintItemsStr = trip.maintenanceItems
			? trip.maintenanceItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ')
			: '';

		const supplies = trip.suppliesCost || 0;
		const sItems = trip.suppliesItems || trip.supplyItems;
		const supplyItemsStr = sItems ? sItems.map((i: any) => `${i.type}:${i.cost}`).join(' | ') : '';

		const totalExpenses = fuel + maint + supplies;
		const netProfit = revenue - totalExpenses;
		const hourlyPay = trip.hoursWorked > 0 ? netProfit / trip.hoursWorked : 0;

		return [
			escapeCSVField(date),
			escapeCSVField(trip.startAddress || ''),
			escapeCSVField(intermediateStops),
			escapeCSVField(rawEnd || ''),
			escapeCSVField((trip.totalMiles || 0).toFixed(1)),
			escapeCSVField(formatDuration(trip.estimatedTime || 0)),
			escapeCSVField((trip.hoursWorked || 0).toFixed(1)),
			escapeCSVField(hourlyPay.toFixed(2)),
			escapeCSVField(revenue.toFixed(2)),
			escapeCSVField(fuel.toFixed(2)),
			escapeCSVField(maint.toFixed(2)),
			escapeCSVField(maintItemsStr),
			escapeCSVField(supplies.toFixed(2)),
			escapeCSVField(supplyItemsStr),
			escapeCSVField(totalExpenses.toFixed(2)),
			escapeCSVField(netProfit.toFixed(2)),
			escapeCSVField(trip.notes || '')
		].join(',');
	});

	if (includeSummary) {
		const totalMiles = trips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
		const totalRevenue = trips.reduce(
			(sum, t) =>
				sum + (t.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0),
			0
		);
		const totalExpenses = trips.reduce(
			(sum, t) => sum + (t.fuelCost || 0) + (t.maintenanceCost || 0) + (t.suppliesCost || 0),
			0
		);
		const netProfit = totalRevenue - totalExpenses;

		rows.push('');
		rows.push(
			[
				'TOTALS',
				'',
				'',
				'',
				totalMiles.toFixed(1),
				'',
				'',
				'',
				totalRevenue.toFixed(2),
				'',
				'',
				'',
				'',
				'',
				totalExpenses.toFixed(2),
				netProfit.toFixed(2),
				''
			].join(',')
		);
	}

	return [headers.join(','), ...rows].join('\n');
}

export function generateExpensesCSV(
	expenses: any[],
	trips: any[],
	includeSummary: boolean = true
): string | null {
	const allExpenses: Array<{
		date: string;
		category: string;
		amount: number;
		description: string;
	}> = [];

	// 1. Add expenses from expense store
	expenses.forEach((expense) => {
		allExpenses.push({
			date: expense.date,
			category: expense.category,
			amount: expense.amount,
			description: expense.description || ''
		});
	});

	// 2. Add trip-level expenses
	trips.forEach((trip) => {
		if (trip.fuelCost && trip.fuelCost > 0) {
			allExpenses.push({
				date: trip.date || '',
				category: 'Fuel',
				amount: trip.fuelCost,
				description: 'From trip'
			});
		}
		// Maintenance
		if (trip.maintenanceItems?.length > 0) {
			trip.maintenanceItems.forEach((item: any) => {
				allExpenses.push({
					date: trip.date || '',
					category: 'Maintenance',
					amount: item.cost,
					description: item.type
				});
			});
		} else if (trip.maintenanceCost > 0) {
			allExpenses.push({
				date: trip.date || '',
				category: 'Maintenance',
				amount: trip.maintenanceCost,
				description: 'From trip'
			});
		}
		// Supplies
		const sItems = trip.suppliesItems || trip.supplyItems;
		if (sItems?.length > 0) {
			sItems.forEach((item: any) => {
				allExpenses.push({
					date: trip.date || '',
					category: 'Supplies',
					amount: item.cost,
					description: item.type
				});
			});
		} else if (trip.suppliesCost > 0) {
			allExpenses.push({
				date: trip.date || '',
				category: 'Supplies',
				amount: trip.suppliesCost,
				description: 'From trip'
			});
		}
	});

	if (allExpenses.length === 0) return null;

	allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

	const expensesByDate: Record<string, Record<string, number>> = {};
	const categories = new Set<string>();

	allExpenses.forEach((exp) => {
		const dateKey = exp.date ? formatDate(exp.date) : 'Unknown';
		expensesByDate[dateKey] = expensesByDate[dateKey] ?? {};
		categories.add(exp.category);
		expensesByDate[dateKey][exp.category] =
			(expensesByDate[dateKey][exp.category] || 0) + exp.amount;
	});

	const categoryList = Array.from(categories).sort();
	// [!code fix] Use escapeCSVField for all headers including user-defined categories
	let csv = 'Date,' + categoryList.map((c) => escapeCSVField(c)).join(',') + ',Daily Total\n';

	const categoryTotals: Record<string, number> = {};
	categoryList.forEach((cat) => (categoryTotals[cat] = 0));
	let grandTotal = 0;

	Object.entries(expensesByDate).forEach(([date, cats]) => {
		const row: string[] = [escapeCSVField(date)];
		let dailyTotal = 0;
		categoryList.forEach((category) => {
			const amount = cats[category] ?? 0;
			row.push(escapeCSVField(amount.toFixed(2)));
			categoryTotals[category] = (categoryTotals[category] || 0) + amount;
			dailyTotal += amount;
		});
		row.push(escapeCSVField(dailyTotal.toFixed(2)));
		grandTotal += dailyTotal;
		csv += row.join(',') + '\n';
	});

	if (includeSummary) {
		csv += '\n';
		const totalRow = [
			escapeCSVField('TOTALS'),
			...categoryList.map((cat) => escapeCSVField((categoryTotals[cat] || 0).toFixed(2))),
			escapeCSVField(grandTotal.toFixed(2))
		];
		csv += totalRow.join(',') + '\n';
	}

	return csv;
}

export function generateTaxBundleCSV(trips: any[], expenses: any[], dateRangeStr: string): string {
	// 1. Calculate Summary Data
	const totalMiles = trips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
	const mileageDeduction = totalMiles * 0.67; // 2024 Standard Mileage Rate

	const allExpenses: any[] = [];
	expenses.forEach((e) => allExpenses.push({ ...e, source: 'Expense Log' }));
	trips.forEach((t) => {
		if (t.fuelCost) allExpenses.push({ category: 'Fuel', amount: t.fuelCost, source: 'Trip' });
		if (t.maintenanceCost)
			allExpenses.push({ category: 'Maintenance', amount: t.maintenanceCost, source: 'Trip' });
		if (t.maintenanceItems)
			t.maintenanceItems.forEach((i: any) =>
				allExpenses.push({ category: 'Maintenance', amount: i.cost, source: 'Trip' })
			);
		if (t.suppliesCost)
			allExpenses.push({ category: 'Supplies', amount: t.suppliesCost, source: 'Trip' });
		if (t.suppliesItems || t.supplyItems)
			(t.suppliesItems || t.supplyItems).forEach((i: any) =>
				allExpenses.push({ category: 'Supplies', amount: i.cost, source: 'Trip' })
			);
	});
	const totalExpenses = allExpenses.reduce((sum, e) => sum + e.amount, 0);

	// 2. Build CSV
	let csv = `TAX BUNDLE EXPORT - ${dateRangeStr}\n`;
	csv += `Generated: ${new Date().toLocaleString()}\n\n`;

	csv += `SUMMARY COMPARISON\n`;
	csv += `Method,Details,Deduction Value\n`;
	csv += `Standard Mileage Deduction,${totalMiles.toFixed(1)} miles @ $0.67/mi,${mileageDeduction.toFixed(2)}\n`;
	csv += `Actual Expenses Deduction,Sum of all business expenses,${totalExpenses.toFixed(2)}\n\n`;

	csv += `----------------------------------------\n`;
	csv += `PART 1: MILEAGE LOG\n`;
	csv += `----------------------------------------\n`;
	const tripsCsv = generateTripsCSV(trips, false); // Get trips CSV without summary row
	if (tripsCsv) csv += tripsCsv + '\n\n';
	else csv += 'No trips recorded.\n\n';

	csv += `----------------------------------------\n`;
	csv += `PART 2: EXPENSE LOG\n`;
	csv += `----------------------------------------\n`;
	const expensesCsv = generateExpensesCSV(expenses, trips, false); // Get expenses CSV without summary row
	if (expensesCsv) csv += expensesCsv + '\n';
	else csv += 'No expenses recorded.\n';

	return csv;
}

export function generateTripsPDF(): never {
	throw new Error(
		'moved to export-utils-pdf; import dynamically: await import("./export-utils-pdf")'
	);
}

export async function generateExpensesPDF(expenses: any[], trips: any[], dateRangeStr: string) {
	const { jsPDF } = await import('jspdf');
	const autoTable = (await import('jspdf-autotable')).default;
	const doc = new jsPDF();
	const logoData = await getLogoDataUrl();
	const pageWidth = doc.internal.pageSize.getWidth();

	const allExpenses: Array<any> = [];
	expenses.forEach((exp) =>
		allExpenses.push({
			date: exp.date,
			category: exp.category,
			amount: exp.amount,
			description: exp.description || '',
			source: 'Expense Log'
		})
	);

	trips.forEach((trip) => {
		if (trip.fuelCost > 0)
			allExpenses.push({
				date: trip.date,
				category: 'Fuel',
				amount: trip.fuelCost,
				description: 'From trip',
				source: 'Trip'
			});
		if (trip.maintenanceItems?.length > 0) {
			trip.maintenanceItems.forEach((item: any) =>
				allExpenses.push({
					date: trip.date,
					category: 'Maintenance',
					amount: item.cost,
					description: item.type,
					source: 'Trip'
				})
			);
		} else if (trip.maintenanceCost > 0) {
			allExpenses.push({
				date: trip.date,
				category: 'Maintenance',
				amount: trip.maintenanceCost,
				description: 'From trip',
				source: 'Trip'
			});
		}
		const sItems = trip.suppliesItems || trip.supplyItems;
		if (sItems?.length > 0) {
			sItems.forEach((item: any) =>
				allExpenses.push({
					date: trip.date,
					category: 'Supplies',
					amount: item.cost,
					description: item.type,
					source: 'Trip'
				})
			);
		} else if (trip.suppliesCost > 0) {
			allExpenses.push({
				date: trip.date,
				category: 'Supplies',
				amount: trip.suppliesCost,
				description: 'From trip',
				source: 'Trip'
			});
		}
	});

	allExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

	doc.setFillColor(255, 127, 80);
	doc.rect(0, 0, pageWidth, 35, 'F');
	if (logoData) doc.addImage(logoData, 'PNG', 10, 5, 25, 25);

	doc.setTextColor(255, 255, 255);
	doc.setFontSize(24);
	doc.setFont('helvetica', 'bold');
	doc.text('Expense Report', pageWidth / 2, 15, { align: 'center' });
	doc.setFontSize(11);
	doc.setFont('helvetica', 'normal');
	doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, {
		align: 'center'
	});

	doc.setTextColor(0, 0, 0);
	doc.setFontSize(9);
	doc.text(`Period: ${dateRangeStr}`, 14, 42);
	doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 47);
	doc.text(`Total Expenses: ${allExpenses.length}`, pageWidth - 14, 42, { align: 'right' });

	const categoryTotals: Record<string, number> = {};
	let grandTotal = 0;
	allExpenses.forEach((exp) => {
		if (!categoryTotals[exp.category]) categoryTotals[exp.category] = 0;
		categoryTotals[exp.category] += exp.amount;
		grandTotal += exp.amount;
	});

	doc.setFillColor(248, 250, 252);
	const categoryCount = Object.keys(categoryTotals).length;
	const boxHeight = 12 + categoryCount * 6 + 8;
	doc.roundedRect(14, 52, pageWidth - 28, boxHeight, 3, 3, 'FD');

	doc.setFontSize(11);
	doc.setFont('helvetica', 'bold');
	doc.text('Summary by Category', 20, 60);

	doc.setFontSize(9);
	doc.setFont('helvetica', 'normal');
	let yPos = 68;
	Object.entries(categoryTotals).forEach(([category, total]) => {
		doc.text(category, 20, yPos);
		doc.text(formatCurrency(total), pageWidth - 20, yPos, { align: 'right' });
		yPos += 6;
	});

	doc.setDrawColor(229, 231, 235);
	doc.line(20, yPos, pageWidth - 20, yPos);
	yPos += 6;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.text('Total Expenses', 20, yPos);
	doc.setTextColor(239, 68, 68);
	doc.text(formatCurrency(grandTotal), pageWidth - 20, yPos, { align: 'right' });
	doc.setTextColor(0, 0, 0);

	const tableData = allExpenses.map((exp) => [
		formatDate(exp.date),
		exp.description ? `${exp.category} - ${exp.description}` : exp.category,
		formatCurrency(exp.amount),
		exp.source
	]);

	autoTable(doc, {
		startY: 52 + boxHeight + 8,
		head: [['Date', 'Expense', 'Amount', 'Source']],
		body: tableData,
		theme: 'striped',
		headStyles: {
			fillColor: [255, 127, 80],
			textColor: [255, 255, 255],
			fontSize: 9,
			fontStyle: 'bold',
			halign: 'center'
		},
		styles: {
			fontSize: 9,
			cellPadding: 3,
			overflow: 'linebreak',
			lineColor: [229, 231, 235],
			lineWidth: 0.1
		},
		columnStyles: {
			0: { cellWidth: 25 },
			1: { cellWidth: 90 },
			2: { halign: 'right', cellWidth: 30, textColor: [239, 68, 68], fontStyle: 'bold' },
			3: { halign: 'center', cellWidth: 30 }
		},
		alternateRowStyles: { fillColor: [249, 250, 251] },
		margin: { left: 14, right: 14 },
		didDrawPage: function (data: any) {
			const pageCount = doc.internal.pages.length - 1;
			doc.setFontSize(8);
			doc.setTextColor(128, 128, 128);
			doc.text(
				`Page ${data.pageNumber} of ${pageCount}`,
				pageWidth / 2,
				doc.internal.pageSize.getHeight() - 10,
				{ align: 'center' }
			);
		}
	});

	return doc;
}

export async function generateTaxBundlePDF(trips: any[], expenses: any[], dateRangeStr: string) {
	const { jsPDF } = await import('jspdf');
	const autoTable = (await import('jspdf-autotable')).default;
	const doc = new jsPDF();
	const logoData = await getLogoDataUrl();
	const pageWidth = doc.internal.pageSize.getWidth();

	// Header
	doc.setFillColor(255, 127, 80);
	doc.rect(0, 0, pageWidth, 35, 'F');
	if (logoData) doc.addImage(logoData, 'PNG', 10, 5, 25, 25);

	doc.setTextColor(255, 255, 255);
	doc.setFontSize(24);
	doc.setFont('helvetica', 'bold');
	doc.text('Tax Bundle Report', pageWidth / 2, 15, { align: 'center' });
	doc.setFontSize(11);
	doc.setFont('helvetica', 'normal');
	doc.text('Go Route Yourself - Professional Route Tracking', pageWidth / 2, 23, {
		align: 'center'
	});

	// Metadata
	doc.setTextColor(0, 0, 0);
	doc.setFontSize(10);
	doc.text(`Period: ${dateRangeStr}`, 14, 45);
	doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 50);

	// --- CALCULATIONS ---
	const totalMiles = trips.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
	const mileageDeduction = totalMiles * 0.67;

	// Collate all expenses
	const allExpenses: any[] = [];
	expenses.forEach((e) => allExpenses.push({ ...e, source: 'Expense Log' }));
	trips.forEach((t) => {
		if (t.fuelCost) allExpenses.push({ category: 'Fuel', amount: t.fuelCost, source: 'Trip' });
		if (t.maintenanceCost)
			allExpenses.push({ category: 'Maintenance', amount: t.maintenanceCost, source: 'Trip' });
		if (t.maintenanceItems)
			t.maintenanceItems.forEach((i: any) =>
				allExpenses.push({ category: 'Maintenance', amount: i.cost, source: 'Trip' })
			);
		if (t.suppliesCost)
			allExpenses.push({ category: 'Supplies', amount: t.suppliesCost, source: 'Trip' });
		if (t.suppliesItems || t.supplyItems)
			(t.suppliesItems || t.supplyItems).forEach((i: any) =>
				allExpenses.push({ category: 'Supplies', amount: i.cost, source: 'Trip' })
			);
	});

	const totalExpenses = allExpenses.reduce((sum, e) => sum + e.amount, 0);
	const grandTotalDeduction = mileageDeduction + totalExpenses;

	// --- SUMMARY BOX ---
	doc.setFillColor(248, 250, 252);
	doc.roundedRect(14, 60, pageWidth - 28, 90, 3, 3, 'FD');

	let y = 70;
	doc.setFontSize(14);
	doc.setFont('helvetica', 'bold');
	doc.text('Tax Deduction Summary', 20, y);

	y += 10;
	doc.setFontSize(11);
	doc.text('Mileage Deduction', 20, y);
	doc.setFont('helvetica', 'normal');
	doc.text(`${totalMiles.toFixed(1)} miles @ $0.67/mile`, 20, y + 6);
	doc.setFont('helvetica', 'bold');
	doc.text(formatCurrency(mileageDeduction), pageWidth - 20, y + 6, { align: 'right' });

	y += 20;
	doc.text('Business Expenses', 20, y);
	doc.setFont('helvetica', 'normal');
	doc.text(`${allExpenses.length} items recorded`, 20, y + 6);
	doc.setFont('helvetica', 'bold');
	doc.text(formatCurrency(totalExpenses), pageWidth - 20, y + 6, { align: 'right' });

	y += 20;
	doc.setDrawColor(200, 200, 200);
	doc.line(20, y, pageWidth - 20, y);
	y += 10;

	doc.setFontSize(16);
	doc.setTextColor(255, 127, 80);
	doc.text('Estimated Total Deduction', 20, y);
	doc.text(formatCurrency(grandTotalDeduction), pageWidth - 20, y, { align: 'right' });

	y += 15;
	doc.setFontSize(9);
	doc.setTextColor(100, 100, 100);
	doc.setFont('helvetica', 'italic');
	doc.text(
		'Note: You must choose either Standard Mileage Deduction OR Actual Expenses for your vehicle.',
		20,
		y
	);
	doc.text('This report includes both for your comparison.', 20, y + 5);

	// --- MILEAGE LOG SECTION ---
	doc.addPage();
	doc.setTextColor(255, 127, 80);
	doc.setFontSize(18);
	doc.setFont('helvetica', 'bold');
	doc.text('Mileage Log', 14, 20);

	const tripTableData = trips.map((trip) => {
		const endAddr =
			trip.endAddress ||
			(trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address : '') ||
			trip.startAddress ||
			'';
		return [
			formatDate(trip.date || ''),
			trip.startAddress || '',
			endAddr,
			(trip.totalMiles || 0).toFixed(1) + ' mi',
			(trip.notes || '').substring(0, 30)
		];
	});

	autoTable(doc, {
		startY: 30,
		head: [['Date', 'Start', 'End', 'Miles', 'Notes']],
		body: tripTableData,
		theme: 'striped',
		headStyles: { fillColor: [255, 127, 80] },
		styles: { fontSize: 8, cellPadding: 3 },
		columnStyles: {
			3: { halign: 'right', fontStyle: 'bold' }
		}
	});

	// --- EXPENSE LOG SECTION ---
	doc.addPage();
	doc.setTextColor(255, 127, 80);
	doc.setFontSize(18);
	doc.text('Expense Log', 14, 20);

	const expenseTableData = allExpenses.map((exp) => [
		formatDate(exp.date),
		exp.description ? `${exp.category} - ${exp.description}` : exp.category,
		formatCurrency(exp.amount),
		exp.source
	]);

	autoTable(doc, {
		startY: 30,
		head: [['Date', 'Expense', 'Amount', 'Source']],
		body: expenseTableData,
		theme: 'striped',
		headStyles: { fillColor: [255, 127, 80] },
		styles: { fontSize: 8, cellPadding: 3 },
		columnStyles: {
			2: { halign: 'right', textColor: [239, 68, 68], fontStyle: 'bold' }
		}
	});

	return doc;
}
