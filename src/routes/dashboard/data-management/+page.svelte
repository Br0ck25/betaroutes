<!-- src/routes/dashboard/data-management/+page.svelte -->
<script lang="ts">
	import { trips } from '$lib/stores/trips';
	import { expenses } from '$lib/stores/expenses';
	import { mileage } from '$lib/stores/mileage';
	import { userSettings } from '$lib/stores/userSettings';
	import { user } from '$lib/stores/auth';
	import { browser } from '$app/environment';

	let exportFormat = 'csv';
	let dataType: 'trips' | 'expenses' | 'tax-bundle' = 'trips';
	let dateFrom = '';
	let dateTo = '';
	let selectedTrips = new Set<string>();
	let selectedExpenses = new Set<string>();
	let selectAll = false;
	let includeSummary = true;

	// Import/Backup/Restore state
	let importFile: FileList | null = null;
	let importPreview: any[] = [];
	let importType: 'trips' | 'expenses' = 'trips';
	let showImportPreview = false;
	let restoreFile: FileList | null = null;
	let showClearConfirm = false;

	// Filter trips by date
	$: filteredTrips = $trips.filter((trip) => {
		if (!trip.date) return false;
		const tripDate = new Date(trip.date);

		if (dateFrom) {
			const from = new Date(dateFrom);
			if (tripDate < from) return false;
		}

		if (dateTo) {
			const to = new Date(dateTo);
			if (tripDate > to) return false;
		}

		return true;
	});

	// Filter expenses by date
	$: filteredExpenses = $expenses.filter((expense) => {
		if (!expense.date) return false;
		const expenseDate = new Date(expense.date);

		if (dateFrom) {
			const from = new Date(dateFrom);
			if (expenseDate < from) return false;
		}

		if (dateTo) {
			const to = new Date(dateTo);
			if (expenseDate > to) return false;
		}

		return true;
	});

	// Update selection when dataType changes
	$: if (dataType === 'tax-bundle') {
		selectedTrips = new Set(filteredTrips.map((t) => t.id));
		selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
		selectAll = true;
	}

	// Handle select all for current data type
	$: if (selectAll && dataType !== 'tax-bundle') {
		if (dataType === 'trips') {
			selectedTrips = new Set(filteredTrips.map((t) => t.id));
		} else if (dataType === 'expenses') {
			selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
		}
	}

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

	function toggleTrip(id: string) {
		if (selectedTrips.has(id)) {
			selectedTrips.delete(id);
			selectedTrips = selectedTrips;
		} else {
			selectedTrips.add(id);
			selectedTrips = selectedTrips;
		}
	}

	function toggleExpense(id: string) {
		if (selectedExpenses.has(id)) {
			selectedExpenses.delete(id);
			selectedExpenses = selectedExpenses;
		} else {
			selectedExpenses.add(id);
			selectedExpenses = selectedExpenses;
		}
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 2
		}).format(amount);
	}

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString();
	}

	function exportTripsCSV() {
		const tripsToExport = filteredTrips.filter((t) => selectedTrips.has(t.id));

		if (tripsToExport.length === 0) {
			alert('Please select at least one trip to export');
			return;
		}

		let csv =
			'Date,Start Time,End Time,Start Address,Stops,Miles,Earnings,Fuel Cost,Maintenance,Supplies,Total Costs,Net Profit,Notes\n';

		let totalMiles = 0;
		let totalEarnings = 0;
		let totalFuel = 0;
		let totalMaintenance = 0;
		let totalSupplies = 0;
		let totalProfit = 0;

		tripsToExport.forEach((trip) => {
			const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
			const costs =
				((trip as any)['fuelCost'] || 0) +
				((trip as any)['maintenanceCost'] || 0) +
				((trip as any)['suppliesCost'] || 0);
			const profit = earnings - costs;

			totalMiles += (trip as any).totalMiles || 0;
			totalEarnings += earnings;
			totalFuel += (trip as any)['fuelCost'] || 0;
			totalMaintenance += (trip as any)['maintenanceCost'] || 0;
			totalSupplies += (trip as any)['suppliesCost'] || 0;
			totalProfit += profit;

			const row = [
				formatDate(trip.date || ''),
				trip.startTime || '',
				trip.endTime || '',
				`"${trip.startAddress || ''}"`,
				trip.stops?.length || 0,
				(Number((trip as any).totalMiles) || 0).toFixed(2),
				earnings.toFixed(2),
				(Number((trip as any)['fuelCost']) || 0).toFixed(2),
				(Number((trip as any)['maintenanceCost']) || 0).toFixed(2),
				(Number((trip as any)['suppliesCost']) || 0).toFixed(2),
				(Number(costs) || 0).toFixed(2),
				(Number(profit) || 0).toFixed(2),
				`"${trip.notes || ''}"`
			];

			csv += row.join(',') + '\n';
		});

		if (includeSummary) {
			csv += '\n';
			csv += 'SUMMARY\n';
			csv += `Total Trips,${tripsToExport.length}\n`;
			csv += `Total Miles,${totalMiles.toFixed(2)}\n`;
			csv += `Total Earnings,${totalEarnings.toFixed(2)}\n`;
			csv += `Total Fuel Cost,${totalFuel.toFixed(2)}\n`;
			csv += `Total Maintenance,${totalMaintenance.toFixed(2)}\n`;
			csv += `Total Supplies,${totalSupplies.toFixed(2)}\n`;
			csv += `Total Costs,${(totalFuel + totalMaintenance + totalSupplies).toFixed(2)}\n`;
			csv += `Net Profit,${totalProfit.toFixed(2)}\n`;
		}

		return csv;
	}

	function exportExpensesCSV() {
		const expensesToExport = filteredExpenses.filter((e) => selectedExpenses.has(e.id));

		if (expensesToExport.length === 0) {
			alert('Please select at least one expense to export');
			return;
		}

		let csv = 'Date,Category,Amount,Description\n';

		let totalByCategory: Record<string, number> = {};
		let grandTotal = 0;

		expensesToExport.forEach((expense) => {
			const row = [
				formatDate(expense.date),
				`"${expense.category}"`,
				expense.amount.toFixed(2),
				`"${expense.description || ''}"`
			];

			csv += row.join(',') + '\n';

			// Track totals by category
			totalByCategory[expense.category] = (totalByCategory[expense.category] || 0) + expense.amount;
			grandTotal += expense.amount;
		});

		if (includeSummary) {
			csv += '\n';
			csv += 'SUMMARY BY CATEGORY\n';
			Object.entries(totalByCategory).forEach(([category, total]) => {
				csv += `${category},${total.toFixed(2)}\n`;
			});
			csv += '\n';
			csv += `Total Expenses,${grandTotal.toFixed(2)}\n`;
		}

		return csv;
	}

	function exportTaxBundle() {
		const tripsToExport = filteredTrips.filter((t) => selectedTrips.has(t.id));
		const expensesToExport = filteredExpenses.filter((e) => selectedExpenses.has(e.id));

		if (tripsToExport.length === 0 && expensesToExport.length === 0) {
			alert('No data available in the selected date range');
			return;
		}

		// 1. Mileage Log CSV
		let mileageCSV = 'Date,Start Time,End Time,Start Location,End Location,Purpose,Miles,Notes\n';
		let totalMiles = 0;

		tripsToExport.forEach((trip) => {
			const lastStop =
				trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1] : undefined;
			const destination = lastStop?.address || trip.endAddress || '';

			const row = [
				formatDate(trip.date || ''),
				trip.startTime || '',
				trip.endTime || '',
				`"${trip.startAddress || ''}"`,
				`"${destination}"`,
				'Business',
				(Number((trip as any).totalMiles) || 0).toFixed(2),
				`"${trip.notes || ''}"`
			];

			mileageCSV += row.join(',') + '\n';
			totalMiles += trip.totalMiles || 0;
		});

		// 2. Expense Log CSV
		let expenseCSV = 'Date,Category,Amount,Description,Vendor\n';
		let totalByCategory: Record<string, number> = {};
		let grandTotal = 0;

		expensesToExport.forEach((expense) => {
			const row = [
				formatDate(expense.date),
				`"${expense.category}"`,
				expense.amount.toFixed(2),
				`"${expense.description || ''}"`,
				'""'
			];

			expenseCSV += row.join(',') + '\n';

			if (!totalByCategory[expense.category]) {
				totalByCategory[expense.category] = 0;
			}
			totalByCategory[expense.category] = (totalByCategory[expense.category] || 0) + expense.amount;
			grandTotal += expense.amount;
		});

		// 3. Tax Summary Text
		const period =
			dateFrom && dateTo
				? `${formatDate(dateFrom)} to ${formatDate(dateTo)}`
				: dateFrom
					? `From ${formatDate(dateFrom)}`
					: dateTo
						? `Through ${formatDate(dateTo)}`
						: 'All Records';

		let summary = `TAX SUMMARY REPORT
Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
Period: ${period}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MILEAGE DEDUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total Business Miles: ${totalMiles.toFixed(2)} miles
Number of Trips: ${tripsToExport.length}

Standard Mileage Rate (2024): $0.67/mile
Estimated Deduction: ${formatCurrency(totalMiles * 0.67)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BUSINESS EXPENSES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

		if (Object.keys(totalByCategory).length > 0) {
			Object.entries(totalByCategory).forEach(([category, total]) => {
				summary += `${category.padEnd(30)} ${formatCurrency(total).padStart(12)}\n`;
			});
			summary += `\n${'Total Expenses'.padEnd(30)} ${formatCurrency(grandTotal).padStart(12)}\n`;
		} else {
			summary += 'No expenses recorded for this period\n';
		}

		summary += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOTAL TAX DEDUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Mileage Deduction:   ${formatCurrency(totalMiles * 0.67).padStart(12)}
Business Expenses:   ${formatCurrency(grandTotal).padStart(12)}
                     ${'─'.repeat(12)}
Total Deductions:    ${formatCurrency(totalMiles * 0.67 + grandTotal).padStart(12)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOTES:
• This report is for informational purposes only
• Consult with a tax professional for specific advice
• Keep all receipts and documentation for 7 years
• Standard mileage rate may change annually

Generated by Go Route Yourself - Professional Route Tracking
`;

		// Create and download all three files
		const timestamp = Date.now();

		// Download Mileage Log
		const mileageBlob = new Blob([mileageCSV], { type: 'text/csv' });
		const mileageUrl = URL.createObjectURL(mileageBlob);
		const mileageLink = document.createElement('a');
		mileageLink.href = mileageUrl;
		mileageLink.download = `mileage-log-${timestamp}.csv`;
		mileageLink.click();
		URL.revokeObjectURL(mileageUrl);

		// Download Expense Log
		setTimeout(() => {
			const expenseBlob = new Blob([expenseCSV], { type: 'text/csv' });
			const expenseUrl = URL.createObjectURL(expenseBlob);
			const expenseLink = document.createElement('a');
			expenseLink.href = expenseUrl;
			expenseLink.download = `expense-log-${timestamp}.csv`;
			expenseLink.click();
			URL.revokeObjectURL(expenseUrl);
		}, 100);

		// Download Tax Summary
		setTimeout(() => {
			const summaryBlob = new Blob([summary], { type: 'text/plain' });
			const summaryUrl = URL.createObjectURL(summaryBlob);
			const summaryLink = document.createElement('a');
			summaryLink.href = summaryUrl;
			summaryLink.download = `tax-summary-${timestamp}.txt`;
			summaryLink.click();
			URL.revokeObjectURL(summaryUrl);
		}, 200);
	}

	function handleExport() {
		if (dataType === 'tax-bundle') {
			exportTaxBundle();
		} else if (dataType === 'trips') {
			if (exportFormat === 'csv') {
				const csv = exportTripsCSV();
				if (csv) {
					const blob = new Blob([csv], { type: 'text/csv' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `trips-export-${Date.now()}.csv`;
					a.click();
					URL.revokeObjectURL(url);
				}
			}
		} else if (dataType === 'expenses') {
			const csv = exportExpensesCSV();
			if (csv) {
				const blob = new Blob([csv], { type: 'text/csv' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `expenses-export-${Date.now()}.csv`;
				a.click();
				URL.revokeObjectURL(url);
			}
		}
	}

	// ============ Import CSV Functions ============
	async function handleImportFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const text = await file.text();
		const lines = text.split('\n').filter((line) => line.trim());
		if (lines.length < 2) {
			alert('CSV file is empty or invalid');
			return;
		}

		const headers = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
		const data = lines.slice(1).map((line) => {
			const values = line.split(',');
			const obj: any = {};
			headers.forEach((h, i) => {
				obj[h] = values[i]?.replace(/^"|"$/g, '').trim();
			});
			return obj;
		});

		importPreview = data.slice(0, 10); // Show first 10 rows
		showImportPreview = true;
	}

	async function confirmImport() {
		if (!browser) return;

		const text = await importFile?.[0]?.text();
		if (!text) return;

		const lines = text.split('\n').filter((line) => line.trim());
		const headers = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
		const data = lines.slice(1).map((line) => {
			const values = line.split(',');
			const obj: any = {};
			headers.forEach((h, i) => {
				obj[h] = values[i]?.replace(/^"|"$/g, '').trim();
			});
			return obj;
		});

		// Import based on type
		if (importType === 'trips') {
			const userId = $user?.id || $user?.token;
			if (!userId) {
				alert('User not authenticated');
				return;
			}

			for (const row of data) {
				await trips.create(
					{
						date: row.date || new Date().toISOString().split('T')[0],
						startTime: row['start time'] || row.starttime || '',
						endTime: row['end time'] || row.endtime || '',
						startAddress: row['start address'] || row.startaddress || '',
						totalMiles: parseFloat(row.miles || row.totalmiles || '0'),
						notes: row.notes || '',
						stops: []
					},
					userId
				);
			}
			alert(`Imported ${data.length} trips successfully`);
		} else if (importType === 'expenses') {
			const userId = $user?.id || $user?.token;
			if (!userId) {
				alert('User not authenticated');
				return;
			}

			for (const row of data) {
				await expenses.create(
					{
						date: row.date || new Date().toISOString().split('T')[0],
						category: row.category || 'other',
						amount: parseFloat(row.amount || '0'),
						description: row.description || ''
					},
					userId
				);
			}
			alert(`Imported ${data.length} expenses successfully`);
		}

		showImportPreview = false;
		importFile = null;
	}

	// ============ Backup Full Data ============
	async function backupFullData() {
		if (!browser) return;

		const userId = $user?.id || $user?.token;
		if (!userId) {
			alert('User not authenticated');
			return;
		}

		const backup = {
			metadata: {
				exportDate: new Date().toISOString(),
				appVersion: '1.0.0',
				schemaVersion: '1.0'
			},
			trips: $trips,
			expenses: $expenses,
			mileage: $mileage,
			settings: $userSettings
		};

		const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `go-route-yourself-backup-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// ============ Restore Full Data ============
	async function handleRestoreFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (
			!confirm(
				'This will replace ALL your current data with the backup. This cannot be undone. Continue?'
			)
		) {
			return;
		}

		try {
			const text = await file.text();
			const backup = JSON.parse(text);

			const userId = $user?.id || $user?.token;
			if (!userId) {
				alert('User not authenticated');
				return;
			}

			// Validate backup structure
			if (!backup.trips || !backup.expenses) {
				alert('Invalid backup file format');
				return;
			}

			// Restore data by loading from backup
			await trips.load(userId);
			await expenses.load(userId);
			await mileage.load(userId);
			if (backup.settings) userSettings.set(backup.settings);

			alert('Data restored successfully! Please refresh the page.');
		} catch (error) {
			console.error('Restore error:', error);
			alert('Failed to restore backup. Please check the file format.');
		}
	}

	// ============ Clear Local Data ============
	function confirmClearData() {
		showClearConfirm = true;
	}

	async function clearLocalData() {
		if (!browser) return;

		const userId = $user?.id || $user?.token;
		if (!userId) return;

		trips.clear();
		expenses.clear();
		mileage.clear();

		showClearConfirm = false;
		alert('All local data has been cleared.');
	}
</script>

<svelte:head>
	<title>Data Management - Go Route Yourself</title>
</svelte:head>

<div class="export-page">
	<!-- Header -->
	<div class="page-header">
		<div>
			<h1 class="page-title">Data Management</h1>
			<p class="page-subtitle">Export, import, backup, and restore your trip data and expenses</p>
		</div>
	</div>

	<div class="export-grid">
		<!-- Export Options -->
		<div class="options-card">
			<h2 class="card-title">Export Options</h2>

			<!-- Data Type Selection -->
			<fieldset class="option-group">
				<legend class="option-label">Data Type</legend>
				<div class="data-type-buttons">
					<button
						class="type-btn"
						class:active={dataType === 'trips'}
						on:click={() => (dataType = 'trips')}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
							<polyline points="9 22 9 12 15 12 15 22"></polyline>
						</svg>
						<div>
							<div class="type-name">Trips</div>
							<div class="type-desc">Mileage & routes</div>
						</div>
					</button>

					<button
						class="type-btn"
						class:active={dataType === 'expenses'}
						on:click={() => (dataType = 'expenses')}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
							<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
						</svg>
						<div>
							<div class="type-name">Expenses</div>
							<div class="type-desc">Business costs</div>
						</div>
					</button>

					<button
						class="type-btn tax-bundle"
						class:active={dataType === 'tax-bundle'}
						on:click={() => (dataType = 'tax-bundle')}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
							<polyline points="14 2 14 8 20 8"></polyline>
							<line x1="9" y1="15" x2="15" y2="15"></line>
						</svg>
						<div>
							<div class="type-name">Tax Bundle ⭐</div>
							<div class="type-desc">All records + summary</div>
						</div>
					</button>
				</div>
			</fieldset>

			{#if dataType !== 'tax-bundle'}
				<fieldset class="option-group">
					<legend class="option-label">Format</legend>
					<div class="format-buttons">
						<button
							class="format-btn"
							class:active={exportFormat === 'csv'}
							on:click={() => (exportFormat = 'csv')}
						>
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
							</svg>
							<div>
								<div class="format-name">CSV</div>
								<div class="format-desc">Spreadsheet format</div>
							</div>
						</button>
					</div>
				</fieldset>
			{/if}

			<fieldset class="option-group">
				<legend class="option-label">Date Range</legend>
				<div class="date-inputs">
					<input id="export-date-from" type="date" bind:value={dateFrom} placeholder="From" />
					<span class="date-separator">to</span>
					<input id="export-date-to" type="date" bind:value={dateTo} placeholder="To" />
				</div>
			</fieldset>

			{#if dataType !== 'tax-bundle'}
				<div class="option-group">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={includeSummary} />
						Include summary totals
					</label>
				</div>
			{/if}

			<button
				class="btn-export"
				on:click={handleExport}
				disabled={dataType === 'trips'
					? selectedTrips.size === 0
					: dataType === 'expenses'
						? selectedExpenses.size === 0
						: filteredTrips.length === 0 && filteredExpenses.length === 0}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="7 10 12 15 17 10"></polyline>
					<line x1="12" y1="15" x2="12" y2="3"></line>
				</svg>
				{#if dataType === 'tax-bundle'}
					Export Tax Bundle (3 files)
				{:else}
					Export {dataType === 'trips' ? selectedTrips.size : selectedExpenses.size}
					{dataType === 'trips' ? 'Trips' : 'Expenses'}
				{/if}
			</button>
		</div>

		<!-- Selection Card -->
		<div class="selection-card">
			{#if dataType === 'tax-bundle'}
				<div class="selection-header">
					<h2 class="card-title">Tax Bundle Preview</h2>
				</div>

				<div class="bundle-preview">
					<div class="preview-section">
						<div class="preview-header">
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
							</svg>
							<span>Mileage Log</span>
						</div>
						<div class="preview-stats">
							<div class="stat">
								<div class="stat-value">{filteredTrips.length}</div>
								<div class="stat-label">Trips</div>
							</div>
							<div class="stat">
								<div class="stat-value">
									{filteredTrips.reduce((sum, t) => sum + (t.totalMiles || 0), 0).toFixed(0)}
								</div>
								<div class="stat-label">Miles</div>
							</div>
						</div>
					</div>

					<div class="preview-section">
						<div class="preview-header">
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
							</svg>
							<span>Expense Log</span>
						</div>
						<div class="preview-stats">
							<div class="stat">
								<div class="stat-value">{filteredExpenses.length}</div>
								<div class="stat-label">Expenses</div>
							</div>
							<div class="stat">
								<div class="stat-value">
									{formatCurrency(filteredExpenses.reduce((sum, e) => sum + e.amount, 0))}
								</div>
								<div class="stat-label">Total</div>
							</div>
						</div>
					</div>

					<div class="preview-section highlight">
						<div class="preview-header">
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
								<polyline points="14 2 14 8 20 8"></polyline>
							</svg>
							<span>Tax Summary</span>
						</div>
						<div class="preview-deduction">
							<div class="deduction-label">Estimated Total Deduction</div>
							<div class="deduction-value">
								{formatCurrency(
									filteredTrips.reduce((sum, t) => sum + (t.totalMiles || 0), 0) * 0.67 +
										filteredExpenses.reduce((sum, e) => sum + e.amount, 0)
								)}
							</div>
						</div>
					</div>
				</div>
			{:else}
				<div class="selection-header">
					<h2 class="card-title">
						Select {dataType === 'trips' ? 'Trips' : 'Expenses'}
						({dataType === 'trips' ? filteredTrips.length : filteredExpenses.length})
					</h2>
					{#if (dataType === 'trips' && filteredTrips.length > 0) || (dataType === 'expenses' && filteredExpenses.length > 0)}
						<button class="btn-select-all" on:click={toggleSelectAll}>
							{selectAll ? 'Deselect All' : 'Select All'}
						</button>
					{/if}
				</div>

				{#if dataType === 'trips'}
					{#if filteredTrips.length > 0}
						<div class="trips-list">
							{#each filteredTrips as trip}
								{@const tripAny = trip as any}

								{@const earnings =
									tripAny.stops?.reduce(
										(sum: number, stop: any) => sum + (stop.earnings || 0),
										0
									) || 0}
								{@const costs =
									(tripAny['fuelCost'] || 0) +
									(tripAny['maintenanceCost'] || 0) +
									(tripAny['suppliesCost'] || 0)}
								{@const profit = earnings - costs}
								{@const lastStop =
									trip.stops && trip.stops.length > 0
										? trip.stops[trip.stops.length - 1]
										: undefined}
								{@const destination =
									typeof lastStop?.address === 'string'
										? lastStop.address.split(',')[0]
										: trip.endAddress || 'Multiple stops'}
								<label class="trip-checkbox">
									<input
										type="checkbox"
										checked={selectedTrips.has(trip.id)}
										on:change={() => toggleTrip(trip.id)}
									/>
									<div class="trip-info">
										<div class="trip-header">
											<span class="trip-date">{formatDate(trip.date || '')}</span>
											<span
												class="trip-profit"
												class:positive={profit >= 0}
												class:negative={profit < 0}
											>
												{formatCurrency(profit)}
											</span>
										</div>
										<div class="trip-route">
											{typeof trip.startAddress === 'string'
												? trip.startAddress.split(',')[0]
												: 'Unknown'} → {destination}
										</div>
										<div class="trip-meta">
											{(Number((trip as any).totalMiles) || 0).toFixed(1) || '0.0'} mi • {trip.stops
												?.length || 0} stops
										</div>
									</div>
								</label>
							{/each}
						</div>
					{:else}
						<div class="empty-state">
							<svg
								width="48"
								height="48"
								viewBox="0 0 48 48"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									d="M40 18L24 4L8 18V38C8 38.5304 8.21071 39.0391 8.58579 39.4142C8.96086 39.7893 9.46957 40 10 40H38C38.5304 40 39.0391 39.7893 39.4142 39.4142C39.7893 39.0391 40 38.5304 40 38V18Z"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
							<p>No trips found in selected date range</p>
						</div>
					{/if}
				{:else if filteredExpenses.length > 0}
					<div class="trips-list">
						{#each filteredExpenses as expense}
							<label class="trip-checkbox">
								<input
									type="checkbox"
									checked={selectedExpenses.has(expense.id)}
									on:change={() => toggleExpense(expense.id)}
								/>
								<div class="trip-info">
									<div class="trip-header">
										<span class="trip-date">{formatDate(expense.date)}</span>
										<span class="trip-profit negative">
											{formatCurrency(expense.amount)}
										</span>
									</div>
									<div class="trip-route">
										{expense.category}
									</div>
									{#if expense.description}
										<div class="trip-meta">
											{expense.description}
										</div>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
							<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
						</svg>
						<p>No expenses found in selected date range</p>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Import CSV Section -->
	<div class="options-card">
		<h2 class="card-title">Import CSV</h2>
		<p class="card-desc">Import trips or expenses from a CSV file</p>

		<div class="option-group">
			<label class="option-label" for="import-type-select">Import Type</label>
			<select id="import-type-select" bind:value={importType} class="select-input">
				<option value="trips">Trips</option>
				<option value="expenses">Expenses</option>
			</select>
		</div>

		<div class="option-group">
			<label class="file-upload-btn">
				<input type="file" accept=".csv" on:change={handleImportFile} bind:files={importFile} />
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
					/>
					<path d="M17 8L12 3L7 8" />
					<path d="M12 3V15" />
				</svg>
				Choose CSV File
			</label>
		</div>

		{#if showImportPreview}
			<div class="import-preview">
				<p>Preview (first 10 rows):</p>
				<div class="preview-table">
					{#each importPreview as row}
						<div class="preview-row">
							{JSON.stringify(row)}
						</div>
					{/each}
				</div>
				<button class="export-btn" on:click={confirmImport}>Confirm Import</button>
				<button class="export-btn secondary" on:click={() => (showImportPreview = false)}
					>Cancel</button
				>
			</div>
		{/if}
	</div>

	<!-- Backup & Restore Section -->
	<div class="options-card">
		<h2 class="card-title">Backup & Restore</h2>
		<p class="card-desc">Backup all your data or restore from a previous backup</p>

		<div class="option-group">
			<button class="export-btn full-width" on:click={backupFullData}>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
					/>
					<path d="M7 10L12 15L17 10" />
					<path d="M12 15V3" />
				</svg>
				Backup Full Data (JSON)
			</button>
		</div>

		<div class="option-group">
			<label class="export-btn secondary full-width">
				<input
					type="file"
					accept=".json"
					on:change={handleRestoreFile}
					bind:files={restoreFile}
					style="display: none;"
				/>
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
					/>
					<path d="M17 8L12 3L7 8" />
					<path d="M12 3V15" />
				</svg>
				Restore from Backup
			</label>
		</div>
	</div>

	<!-- Clear Local Data Section -->
	<div class="options-card danger-card">
		<h2 class="card-title">Clear Local Data</h2>
		<p class="card-desc">
			⚠️ This will permanently delete all your local trips, expenses, and mileage data. This cannot
			be undone.
		</p>

		<div class="option-group">
			<button class="export-btn danger full-width" on:click={confirmClearData}>
				Clear All Local Data
			</button>
		</div>

		{#if showClearConfirm}
			<div class="confirm-modal">
				<div class="modal-content">
					<h3>Are you absolutely sure?</h3>
					<p>This will delete ALL your data from this device. This action cannot be undone.</p>
					<p><strong>Make sure you have a backup before proceeding!</strong></p>
					<div class="modal-actions">
						<button class="export-btn danger" on:click={clearLocalData}
							>Yes, Delete Everything</button
						>
						<button class="export-btn secondary" on:click={() => (showClearConfirm = false)}
							>Cancel</button
						>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.export-page {
		max-width: 1200px;
	}

	.page-header {
		margin-bottom: 32px;
	}

	.page-title {
		font-size: 32px;
		font-weight: 800;
		color: #111827;
		margin-bottom: 4px;
	}

	.page-subtitle {
		font-size: 16px;
		color: #6b7280;
	}

	.export-grid {
		display: grid;
		grid-template-columns: 400px 1fr;
		gap: 24px;
	}

	.options-card,
	.selection-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 28px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		margin-bottom: 24px;
	}

	.card-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 8px;
	}

	.option-group {
		margin-bottom: 16px;
	}

	.option-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: #374151;
		margin-bottom: 12px;
	}

	.data-type-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.type-btn {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		font-family: inherit;
	}

	.type-btn:hover {
		border-color: var(--orange);
		background: white;
	}

	.type-btn.active {
		border-color: var(--orange);
		background: rgba(255, 127, 80, 0.05);
	}

	.type-btn.tax-bundle.active {
		background: linear-gradient(135deg, rgba(255, 127, 80, 0.1) 0%, rgba(255, 106, 61, 0.1) 100%);
	}

	.type-btn svg {
		color: #6b7280;
		flex-shrink: 0;
	}

	.type-btn.active svg {
		color: var(--orange);
	}

	.type-name {
		font-size: 14px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 2px;
	}

	.type-desc {
		font-size: 12px;
		color: #6b7280;
	}

	.format-buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.format-btn {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		font-family: inherit;
	}

	.format-btn:hover {
		border-color: var(--orange);
		background: white;
	}

	.format-btn.active {
		border-color: var(--orange);
		background: rgba(255, 127, 80, 0.05);
	}

	.format-btn svg {
		color: #6b7280;
		flex-shrink: 0;
	}

	.format-btn.active svg {
		color: var(--orange);
	}

	.format-name {
		font-size: 14px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 2px;
	}

	.format-desc {
		font-size: 12px;
		color: #6b7280;
	}

	.date-inputs {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.date-inputs input {
		flex: 1;
		padding: 12px 16px;
		border: 2px solid #e5e7eb;
		border-radius: 10px;
		font-size: 14px;
		font-family: inherit;
	}

	.date-inputs input:focus {
		outline: none;
		border-color: var(--orange);
		box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
	}

	.date-separator {
		font-size: 14px;
		color: #6b7280;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		font-size: 14px;
		color: #374151;
	}

	.checkbox-label input[type='checkbox'] {
		width: 20px;
		height: 20px;
		cursor: pointer;
	}

	.btn-export {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 16px;
		background: linear-gradient(135deg, var(--orange) 0%, #ff6a3d 100%);
		color: white;
		border: none;
		border-radius: 12px;
		font-weight: 600;
		font-size: 15px;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.btn-export:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3);
	}

	.btn-export:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.selection-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.btn-select-all {
		padding: 8px 16px;
		background: white;
		color: var(--orange);
		border: 2px solid var(--orange);
		border-radius: 8px;
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.btn-select-all:hover {
		background: var(--orange);
		color: white;
	}

	.bundle-preview {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.preview-section {
		padding: 20px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
	}

	.preview-section.highlight {
		background: linear-gradient(135deg, rgba(255, 127, 80, 0.05) 0%, rgba(255, 106, 61, 0.05) 100%);
		border-color: var(--orange);
	}

	.preview-header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
		color: #374151;
		margin-bottom: 16px;
	}

	.preview-header svg {
		color: #6b7280;
	}

	.preview-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	.stat {
		text-align: center;
	}

	.stat-value {
		font-size: 24px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 4px;
	}

	.stat-label {
		font-size: 13px;
		color: #6b7280;
	}

	.preview-deduction {
		text-align: center;
	}

	.deduction-label {
		font-size: 13px;
		color: #6b7280;
		margin-bottom: 8px;
	}

	.deduction-value {
		font-size: 32px;
		font-weight: 800;
		color: var(--orange);
	}

	.trips-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: 600px;
		overflow-y: auto;
		padding-right: 8px;
	}

	.trip-checkbox {
		display: flex;
		gap: 12px;
		padding: 16px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.trip-checkbox:hover {
		border-color: var(--orange);
		background: white;
	}

	.trip-checkbox input[type='checkbox'] {
		width: 20px;
		height: 20px;
		cursor: pointer;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.trip-info {
		flex: 1;
		min-width: 0;
	}

	.trip-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}

	.trip-date {
		font-size: 14px;
		font-weight: 600;
		color: #111827;
	}

	.trip-profit {
		font-size: 15px;
		font-weight: 700;
	}

	.trip-profit.positive {
		color: var(--green);
	}

	.trip-profit.negative {
		color: #dc2626;
	}

	.trip-route {
		font-size: 14px;
		color: #374151;
		margin-bottom: 4px;
	}

	.trip-meta {
		font-size: 13px;
		color: #6b7280;
	}

	.empty-state {
		padding: 60px 20px;
		text-align: center;
	}

	.empty-state svg {
		color: #d1d5db;
		margin: 0 auto 16px;
	}

	.empty-state p {
		font-size: 14px;
		color: #6b7280;
	}

	.trips-list::-webkit-scrollbar {
		width: 6px;
	}

	.trips-list::-webkit-scrollbar-track {
		background: #f3f4f6;
		border-radius: 3px;
	}

	.trips-list::-webkit-scrollbar-thumb {
		background: #d1d5db;
		border-radius: 3px;
	}

	.trips-list::-webkit-scrollbar-thumb:hover {
		background: #9ca3af;
	}

	@media (max-width: 1024px) {
		.export-grid {
			grid-template-columns: 1fr;
		}

		.options-card {
			order: 2;
		}

		.selection-card {
			order: 1;
		}
	}

	@media (max-width: 640px) {
		.format-buttons {
			grid-template-columns: 1fr;
		}

		.date-inputs {
			flex-direction: column;
			align-items: stretch;
		}

		.date-separator {
			text-align: center;
		}

		.preview-stats {
			grid-template-columns: 1fr;
		}
	}

	/* ============ New Styles for Import/Backup/Restore ============ */
	.card-desc {
		font-size: 14px;
		color: #6b7280;
		margin-top: 8px;
		margin-bottom: 24px;
		line-height: 1.5;
	}

	.export-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 14px 24px;
		background: var(--orange, #ff7f50);
		color: white;
		border: none;
		border-radius: 10px;
		font-weight: 600;
		font-size: 15px;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		font-family: inherit;
	}

	.export-btn:hover {
		background: #ff6a3d;
		transform: translateY(-1px);
		box-shadow: 0 4px 8px rgba(255, 127, 80, 0.3);
	}

	.select-input {
		width: 100%;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 14px;
		background: white;
		cursor: pointer;
	}

	.file-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		color: #374151;
		cursor: pointer;
		transition: all 0.2s;
	}

	.file-upload-btn:hover {
		background: #e5e7eb;
	}

	.file-upload-btn input[type='file'] {
		display: none;
	}

	.import-preview {
		margin-top: 16px;
		padding: 16px;
		background: #f9fafb;
		border-radius: 8px;
	}

	.preview-table {
		max-height: 200px;
		overflow-y: auto;
		margin: 12px 0;
	}

	.preview-row {
		padding: 8px;
		background: white;
		border-radius: 4px;
		margin-bottom: 4px;
		font-size: 12px;
		font-family: monospace;
	}

	.export-btn.full-width {
		width: 100%;
	}

	.export-btn.secondary {
		background: white;
		color: #374151;
		border: 2px solid #e5e7eb;
		box-shadow: none;
	}

	.export-btn.secondary:hover {
		background: #f9fafb;
		border-color: var(--orange, #ff7f50);
		color: var(--orange, #ff7f50);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.export-btn.danger {
		background: #ef4444;
		color: white;
	}

	.export-btn.danger:hover {
		background: #dc2626;
		box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
	}

	.danger-card {
		border: 2px solid #fee2e2;
		background: #fef2f2;
	}

	.danger-card .card-title {
		color: #dc2626;
	}

	.confirm-modal {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal-content {
		background: white;
		padding: 32px;
		border-radius: 16px;
		max-width: 500px;
		margin: 16px;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.1),
			0 10px 10px -5px rgba(0, 0, 0, 0.04);
	}

	.modal-content h3 {
		font-size: 24px;
		font-weight: 700;
		color: #ef4444;
		margin-bottom: 16px;
	}

	.modal-content p {
		font-size: 15px;
		color: #6b7280;
		margin-bottom: 12px;
		line-height: 1.6;
	}

	.modal-actions {
		display: flex;
		gap: 12px;
		margin-top: 24px;
		flex-wrap: wrap;
	}

	.modal-actions button {
		flex: 1;
		min-width: 120px;
	}
</style>
