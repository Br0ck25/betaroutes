# Implementation Guide for Mileage Export/Import and PDF Tax Bundle

## Changes Needed for data-management/+page.svelte

### 1. Update reactive selections to include mileage in tax-bundle

Find this code (around line 83-87):

```svelte
// Update selection when dataType changes
$: if (dataType === 'tax-bundle') {
	selectedTrips = new Set(filteredTrips.map((t) => t.id));
	selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
	selectAll = true;
}
```

Replace with:

```svelte
// Update selection when dataType changes
$: if (dataType === 'tax-bundle') {
	selectedTrips = new Set(filteredTrips.map((t) => t.id));
	selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
	selectedMileage = new Set(filteredMileage.map((m) => m.id));
	selectAll = true;
}
```

### 2. Update select all handler to include mileage

Find this code (around line 90-96):

```svelte
// Handle select all for current data type
$: if (selectAll && dataType !== 'tax-bundle') {
	if (dataType === 'trips') {
		selectedTrips = new Set(filteredTrips.map((t) => t.id));
	} else if (dataType === 'expenses') {
		selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
	}
}
```

Replace with:

```svelte
// Handle select all for current data type
$: if (selectAll && dataType !== 'tax-bundle') {
	if (dataType === 'trips') {
		selectedTrips = new Set(filteredTrips.map((t) => t.id));
	} else if (dataType === 'expenses') {
		selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
	} else if (dataType === 'mileage') {
		selectedMileage = new Set(filteredMileage.map((m) => m.id));
	}
}
```

### 3. Update toggleSelectAll function

Find this code (around line 98-113):

```svelte
function toggleSelectAll() {
	if (dataType === 'trips') {
		if (selectAll) {
			selectedTrips = new Set();
		} else {
			selectedTrips = new Set(filteredTrips.map((t) => t.id));
		}
	} else if (dataType === 'expenses') {
		if (selectAll) {
			selectedExpenses = new Set();
		} else {
			selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
		}
	}
	selectAll = !selectAll;
}
```

Replace with:

```svelte
function toggleSelectAll() {
	if (dataType === 'trips') {
		if (selectAll) {
			selectedTrips = new Set();
		} else {
			selectedTrips = new Set(filteredTrips.map((t) => t.id));
		}
	} else if (dataType === 'expenses') {
		if (selectAll) {
			selectedExpenses = new Set();
		} else {
			selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
		}
	} else if (dataType === 'mileage') {
		if (selectAll) {
			selectedMileage = new Set();
		} else {
			selectedMileage = new Set(filteredMileage.map((m) => m.id));
		}
	}
	selectAll = !selectAll;
}
```

### 4. Add toggleMileage function

Add after the toggleExpense function:

```svelte
function toggleMileage(id: string) {
	if (selectedMileage.has(id)) {
		selectedMileage.delete(id);
		selectedMileage = selectedMileage;
	} else {
		selectedMileage.add(id);
		selectedMileage = selectedMileage;
	}
}
```

### 5. Add exportMileageCSV function

Add after exportExpensesCSV function:

```svelte
function exportMileageCSV() {
	const mileageToExport = filteredMileage.filter((m) => selectedMileage.has(m.id));

	if (mileageToExport.length === 0) {
		alert('Please select at least one mileage log to export');
		return;
	}

	let csv = 'Date,Vehicle,Start Odometer,End Odometer,Miles,Purpose,Notes\n';

	let totalMiles = 0;

	mileageToExport.forEach((m) => {
		const miles = Number(m.miles || 0);
		totalMiles += miles;

		const row = [
			formatDate(m.date || ''),
			`"${m.vehicle || 'Default'}"`,
			m.startOdometer || '',
			m.endOdometer || '',
			miles.toFixed(2),
			`"${m.purpose || 'Business'}"`,
			`"${m.notes || ''}"`
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
```

### 6. Update handleExport function

Find the handleExport function and update it to handle mileage:

```svelte
function handleExport() {
	let content: string;
	let filename: string;

	if (dataType === 'tax-bundle') {
		exportTaxBundle();
		return;
	}

	if (dataType === 'trips') {
		content = exportTripsCSV();
		filename = `trips-export-${new Date().toISOString().split('T')[0]}.csv`;
	} else if (dataType === 'expenses') {
		content = exportExpensesCSV();
		filename = `expenses-export-${new Date().toISOString().split('T')[0]}.csv`;
	} else if (dataType === 'mileage') {
		content = exportMileageCSV();
		filename = `mileage-export-${new Date().toISOString().split('T')[0]}.csv`;
	} else {
		return;
	}

	const blob = new Blob([content], { type: 'text/csv' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
```

### 7. Add Mileage button in UI

Find the data type buttons section (around line 630-700) and add this button after Expenses button and before Tax Bundle button:

```svelte
<button
	class="type-btn"
	class:active={dataType === 'mileage'}
	on:click={() => (dataType = 'mileage')}
>
	<svg
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
	>
		<path
			d="M3 11h18v3a2 2 0 0 1-2 2h-1.5a2 2 0 0 1-4 0H11.5a2 2 0 0 1-4 0H6a2 2 0 0 1-2-2v-3z"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<path d="M5 11L7 6h10l2 5" stroke-linecap="round" stroke-linejoin="round" />
		<circle cx="7.5" cy="17.5" r="1.5" stroke-linecap="round" stroke-linejoin="round" />
		<circle cx="16.5" cy="17.5" r="1.5" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
	<div>
		<div class="type-name">Mileage</div>
		<div class="type-desc">Distance logs</div>
	</div>
</button>
```

### 8. Update Import Type selector

Find the Import Type select element and add mileage option:

```svelte
<select id="import-type-select" bind:value={importType} class="select-input">
	<option value="trips">Trips</option>
	<option value="expenses">Expenses</option>
	<option value="mileage">Mileage</option>
</select>
```

### 9. Update handleImportFile function

Add mileage parsing logic to handle mileage CSV imports:

```svelte
async function handleImportFile(e: Event) {
	// ... existing code ...

	if (importType === 'mileage') {
		// Parse mileage CSV
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
		importPreview = mileageLogs;
	}
}
```

### 10. Update confirmImport function

Add mileage import logic:

```svelte
async function confirmImport() {
	// ... existing code ...

	if (importType === 'mileage') {
		for (const log of importPreview) {
			await mileage.create(log, userId);
		}
	}

	// ... existing code ...
}
```

### 11. Update exportTaxBundle to include mileage

In the exportTaxBundle function, include mileage logs in the tax bundle:

```svelte
function exportTaxBundle() {
	const tripsToExport = filteredTrips.filter((t) => selectedTrips.has(t.id));
	const expensesToExport = filteredExpenses.filter((e) => selectedExpenses.has(e.id));
	const mileageToExport = filteredMileage.filter((m) => selectedMileage.has(m.id));

	// ... existing code for trips and expenses CSV ...

	// 3. Mileage Log CSV
	let mileageCSV = 'Date,Vehicle,Start Odometer,End Odometer,Miles,Purpose,Notes\n';
	let totalMiles = 0;

	mileageToExport.forEach((m) => {
		const miles = Number(m.miles || 0);
		totalMiles += miles;

		const row = [
			formatDate(m.date || ''),
			`"${m.vehicle || 'Default'}"`,
			m.startOdometer || '',
			m.endOdometer || '',
			miles.toFixed(2),
			`"${m.purpose || 'Business'}"`,
			`"${m.notes || ''}"`
		];

		mileageCSV += row.join(',') + '\n';
	});

	// Add mileage to summary text file
	summary += `\n\nMILEAGE LOG\n`;
	summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
	summary += `Total Mileage Logs: ${mileageToExport.length}\n`;
	summary += `Total Miles: ${totalMiles.toFixed(2)} miles\n`;
	summary += `Standard Mileage Rate (2026): $0.725/mile\n`;
	summary += `Estimated Deduction: ${formatCurrency(totalMiles * 0.725)}\n`;

	// Create ZIP with all files including mileage CSV
	// ... add mileage-log.csv to the ZIP bundle
}
```

## Next: PDF Tax Bundle Implementation

This will require creating a new file: `src/routes/dashboard/data-management/lib/pdf-export.ts`

The PDF bundle should include:

1. Tax Summary PDF (1 page overview)
2. Detailed Trip Log PDF
3. IRS-compliant Mileage Log PDF
4. Expense Log PDF (by category)

All packaged in a single ZIP file for download.

Would you like me to proceed with creating the PDF export module?
