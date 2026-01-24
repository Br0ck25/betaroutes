<script lang="ts">
	import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
	import { userSettings } from '$lib/stores/userSettings';
	import { trips } from '$lib/stores/trips';
	import { expenses } from '$lib/stores/expenses';
	import { mileage } from '$lib/stores/mileage';
	import { user } from '$lib/stores/auth';
	import { toasts } from '$lib/stores/toast';
	import { createEventDispatcher } from 'svelte';
	import { localDateISO } from '$lib/utils/dates';

	const dispatch = createEventDispatcher();

	function parseDuration(durationStr?: string): number {
		const s = (durationStr || '').trim();
		if (!s) return 0;
		let minutes = 0;
		const hoursMatch = s.match(/(\d+)h/);
		const minsMatch = s.match(/(\d+)m/);
		if (hoursMatch && hoursMatch[1]) minutes += parseInt(hoursMatch[1], 10) * 60;
		if (minsMatch && minsMatch[1]) minutes += parseInt(minsMatch[1], 10);
		if (!hoursMatch && !minsMatch && !isNaN(Number(s))) {
			minutes = parseInt(s, 10);
		}
		return minutes;
	}

	function parseItemString(str?: string): any[] {
		const s = (str || '').trim();
		if (!s) return [];
		return s
			.split('|')
			.map((part: string) => {
				const [name, costStr] = part.split(':');
				return {
					id: crypto.randomUUID(),
					type: name ? name.trim() : 'Unknown',
					cost: parseFloat(costStr || '0') || 0
				};
			})
			.filter((i: any) => i.type && i.cost >= 0);
	}

	// Parse a single CSV line into columns (handles quoted fields and escaped quotes)
	function parseCsvLine(line: string, maxCols: number = 200): string[] {
		const cols: string[] = [];
		let cur = '';
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const ch = line[i];

			if (ch === '"') {
				// Escaped double quote
				if (inQuotes && line[i + 1] === '"') {
					cur += '"';
					i++; // skip the escaped quote
					continue;
				}
				inQuotes = !inQuotes;
				continue;
			}

			if (ch === ',' && !inQuotes) {
				cols.push(cur);
				cur = '';
				if (cols.length >= maxCols) return cols; // truncate if columns exceed cap
				continue;
			}

			cur += ch;
		}

		cols.push(cur);
		return cols;
	}

	function exportData() {
		const data = {
			settings: $userSettings,
			trips: $trips,
			expenses: $expenses,
			mileage: $mileage,
			exportDate: new Date().toISOString()
		};
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `goroute-backup-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	import { saveSettings } from '../../settings/lib/save-settings';

	async function importData() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'application/json';
		input.onchange = (e: any) => {
			const file = e.target.files[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = async (e: any) => {
				try {
					const data = JSON.parse(e.target.result);
					let importMessages: string[] = [];

					if (data.settings) {
						userSettings.set(data.settings);
						// Try to persist to cloud and update canonical state
						const result = await saveSettings(data.settings);
						if (!result.ok) {
							toasts.error('Settings imported locally, cloud sync failed');
						} else {
							importMessages.push('Settings imported');
						}
					}

					let userId = $user?.id || localStorage.getItem('offline_user_id') || 'offline';
					if (data.trips && Array.isArray(data.trips)) {
						if (confirm(`Found ${data.trips.length} trips in backup. Import them now?`)) {
							for (const trip of data.trips) {
								await trips.create(trip, userId);
							}
							importMessages.push(`${data.trips.length} trips imported`);
						}
					}

					if (data.expenses && Array.isArray(data.expenses)) {
						if (confirm(`Found ${data.expenses.length} expenses in backup. Import them now?`)) {
							for (const expense of data.expenses) {
								await expenses.create(expense, userId);
							}
							importMessages.push(`${data.expenses.length} expenses imported`);
						}
					}

					if (data.mileage && Array.isArray(data.mileage)) {
						if (confirm(`Found ${data.mileage.length} mileage logs in backup. Import them now?`)) {
							for (const log of data.mileage) {
								await mileage.create(log, userId);
							}
							importMessages.push(`${data.mileage.length} mileage logs imported`);
						}
					}

					if (importMessages.length > 0) {
						dispatch('success', `Successfully imported: ${importMessages.join(', ')}`);
					} else {
						dispatch('success', 'No data found in backup file.');
					}
				} catch (err) {
					console.error(err);
					alert('Invalid backup file');
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}

	function importCSV() {
		const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5MB
		const MAX_IMPORT_ROWS = 2000; // safety cap
		const MAX_COLUMNS = 200;

		// [SECURITY] Validate file content matches expected CSV format
		function validateCSVContent(text: string): boolean {
			if (!text || text.length < 5) return false;
			// Check for binary/null bytes that shouldn't be in CSV
			// Check first 1000 chars for null byte (char code 0)
			const sample = text.slice(0, 1000);
			if (sample.includes('\0')) return false;
			// Should have at least one line break
			if (!/\r?\n/.test(text)) return false;
			return true;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv';
		input.onchange = async (e: any) => {
			const file = e.target.files[0];
			if (!file) return;

			// Reject overly large files early to avoid DoS / memory issues
			if (file.size > MAX_IMPORT_SIZE) {
				alert('The selected CSV file is too large. Please use a file smaller than 5MB.');
				return;
			}

			try {
				const text = await file.text();

				// [SECURITY] Validate CSV content structure
				if (!validateCSVContent(text)) {
					alert(
						'The file does not appear to be a valid CSV file. Please ensure you are uploading a CSV file.'
					);
					return;
				}

				const lines = text.split(/\r?\n/);
				if (lines.length < 2) throw new Error('Empty CSV');

				if (lines.length > MAX_IMPORT_ROWS + 1) {
					if (
						!confirm(
							`This CSV has ${lines.length - 1} rows which is more than the recommended ${MAX_IMPORT_ROWS} rows. Continue?`
						)
					)
						return;
				}

				const parsed: any[] = [];
				let processedRows = 0;

				for (let i = 1; i < lines.length; i++) {
					if (!lines[i].trim()) continue;

					// Respect row cap
					if (processedRows >= MAX_IMPORT_ROWS) break;

					// Parse line into columns (handles quoted values and escaped quotes)
					const rowCols = parseCsvLine(lines[i], MAX_COLUMNS);
					if (!rowCols || rowCols.length === 0) continue;

					const cleanRow = rowCols.map((c: string) =>
						c.trim().replace(/^"|"$/g, '').replace(/""/g, '"')
					);
					const stopsStr = cleanRow[2];
					let stops: any[] = [];
					if (stopsStr) {
						stops = stopsStr.split('|').map((s: string) => ({
							address: s.trim(),
							earnings: 0
						}));
					}

					const totalRevenue = parseFloat(String(cleanRow[9] ?? '0')) || 0;
					if (totalRevenue > 0) {
						if (stops.length > 0) stops[0].earnings = totalRevenue;
						else
							stops.push({
								id: crypto.randomUUID(),
								address: 'Revenue Adjustment',
								earnings: totalRevenue
							});
					}

					const estimatedTime = parseDuration(cleanRow[6]);
					const maintenanceCost = parseFloat(String(cleanRow[11] ?? '0')) || 0;
					const suppliesCost = parseFloat(String(cleanRow[13] ?? '0')) || 0;

					let maintenanceItems = parseItemString(cleanRow[12]);
					if (maintenanceItems.length === 0 && maintenanceCost > 0) {
						maintenanceItems.push({
							id: crypto.randomUUID(),
							type: 'Maintenance',
							cost: maintenanceCost
						});
					}

					let suppliesItems = parseItemString(cleanRow[14]);
					if (suppliesItems.length === 0 && suppliesCost > 0) {
						suppliesItems.push({ id: crypto.randomUUID(), type: 'Supplies', cost: suppliesCost });
					}

					parsed.push({
						date: cleanRow[0] ? localDateISO(cleanRow[0]) : localDateISO(),
						startAddress: cleanRow[1] || 'Unknown Start',
						endAddress: cleanRow[3] || cleanRow[1] || 'Unknown End',
						stops: stops,
						totalMiles: parseFloat(String(cleanRow[5] ?? '0')) || 0,
						estimatedTime: estimatedTime,
						totalTime: cleanRow[6],
						hoursWorked: parseFloat(String(cleanRow[7] ?? '0')) || 0,
						fuelCost: parseFloat(String(cleanRow[10] ?? '0')) || 0,
						maintenanceCost: maintenanceCost,
						maintenanceItems: maintenanceItems,
						suppliesCost: suppliesCost,
						suppliesItems: suppliesItems,
						notes: cleanRow[17] || '',
						startTime: '09:00',
						endTime: '17:00',
						mpg: 25,
						gasPrice: 3.5
					});

					processedRows++;
				}

				if (parsed.length > 0) {
					if (confirm(`Found ${parsed.length} trips. Import them now?`)) {
						let userId = $user?.id || localStorage.getItem('offline_user_id') || 'offline';
						for (const trip of parsed) {
							await trips.create(trip, userId);
						}
						dispatch('success', `Successfully imported ${parsed.length} trips from CSV!`);
					}
				} else {
					alert('No valid trips found in CSV.');
				}
			} catch (err) {
				console.error(err);
				alert('Failed to parse CSV file.');
			}
		};
		input.click();
	}

	function clearAllData() {
		if (!confirm('Are you sure? This will delete ALL your trip data locally.')) return;
		trips.clear();
		dispatch('success', 'All trip data cleared.');
	}

	function openAdvancedExport() {
		dispatch('openAdvancedExport');
	}
</script>

<CollapsibleCard
	title="Data Management"
	subtitle="Export, import, and manage your data"
	storageKey="settings:data"
>
	{#snippet icon()}
		<span>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M10 12C11.1046 12 12 11.1046 12 10C12 8.89543 11.1046 8 10 8C8.89543 8 8 8.89543 8 10C8 11.1046 8.89543 12 10 12Z"
					stroke="currentColor"
					stroke-width="2"
				/>
				<path
					d="M16.2 12C16.1 12.5 16.3 13 16.7 13.3L16.8 13.4C17.1 13.7 17.3 14.1 17.3 14.5C17.3 14.9 17.1 15.3 16.8 15.6C16.5 15.9 16.1 16.1 15.7 16.1C15.3 16.1 14.9 15.9 14.6 15.6L14.5 15.5C14.2 15.1 13.7 14.9 13.2 15C12.7 15.1 12.4 15.5 12.3 16V16.2C12.3 17.1 11.6 17.8 10.7 17.8C9.8 17.8 9.1 17.1 9.1 16.2V16.1C9 15.5 8.6 15.1 8 15C7.5 15 7 15.2 6.7 15.6L6.6 15.7C6.3 16 5.9 16.2 5.5 16.2C5.1 16.2 4.7 16 4.4 15.7C4.1 15.4 3.9 15 3.9 14.6C3.9 14.2 4.1 13.8 4.4 13.5L4.5 13.4C4.9 13.1 5.1 12.6 5 12.1C4.9 11.6 4.5 11.3 4 11.2H3.8C2.9 11.2 2.2 10.5 2.2 9.6C2.2 8.7 2.9 8 3.8 8H3.9C4.5 7.9 4.9 7.5 5 6.9C5 6.4 4.8 5.9 4.4 5.6L4.3 5.5C4 5.2 3.8 4.8 3.8 4.4C3.8 4 4 3.6 4.3 3.3C4.6 3 5 2.8 5.4 2.8C5.8 2.8 6.2 3 6.5 3.3L6.6 3.4C7 3.8 7.5 4 8 3.9C8.5 3.9 8.8 3.4 8.9 2.9V2.7C8.9 1.8 9.6 1.1 10.5 1.1C11.4 1.1 12.1 1.8 12.1 2.7V2.8C12.1 3.4 12.5 3.8 13.1 3.9C13.6 4 14.1 3.8 14.4 3.4L14.5 3.3C14.8 3 15.2 2.8 15.6 2.8C16 2.8 16.4 3 16.7 3.3C17 3.6 17.2 4 17.2 4.4C17.2 4.8 17 5.2 16.7 5.5L16.6 5.6C16.2 5.9 16 6.4 16.1 6.9C16.2 7.4 16.6 7.7 17.1 7.8H17.3C18.2 7.8 18.9 8.5 18.9 9.4C18.9 10.3 18.2 11 17.3 11H17.2C16.6 11.1 16.2 11.5 16.1 12.1L16.2 12Z"
					stroke="currentColor"
					stroke-width="2"
				/>
			</svg>
		</span>
	{/snippet}

	<div class="data-actions">
		<button class="action-btn" on:click={openAdvancedExport}>
			<div>
				<div class="action-title">Advanced Export</div>
				<div class="action-subtitle">
					Export trips, expenses, or tax bundle with date filters & PDF
				</div>
			</div>
		</button>

		<div class="divider"></div>

		<button class="action-btn" on:click={importCSV}>
			<div>
				<div class="action-title">Import CSV</div>
				<div class="action-subtitle">Upload trips from spreadsheet</div>
			</div>
		</button>

		<div class="divider"></div>

		<button class="action-btn" on:click={exportData}>
			<div>
				<div class="action-title">Backup Full Data (JSON)</div>
				<div class="action-subtitle">Save settings and trips backup</div>
			</div>
		</button>

		<button class="action-btn" on:click={importData}>
			<div>
				<div class="action-title">Restore Backup (JSON)</div>
				<div class="action-subtitle">Restore from full backup</div>
			</div>
		</button>

		<div class="divider"></div>

		<button class="action-btn danger" on:click={clearAllData}>
			<div>
				<div class="action-title">Clear Local Data</div>
				<div class="action-subtitle">Delete local trip history</div>
			</div>
		</button>
	</div>
</CollapsibleCard>

<style>
	.data-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.action-btn {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		width: 100%;
		position: relative;
	}
	.action-btn:hover {
		border-color: var(--orange, #ff6a3d);
		background: white;
	}

	.action-title {
		font-size: 15px;
		font-weight: 600;
		color: #111827;
	}
	.action-subtitle {
		font-size: 13px;
		color: #6b7280;
	}
	.divider {
		height: 1px;
		background: #e5e7eb;
		margin: 24px 0;
	}
	.action-btn.danger:hover {
		border-color: #dc2626;
		background: white;
	}
</style>
