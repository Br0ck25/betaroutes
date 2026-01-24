<script lang="ts">
	import { trips } from '$lib/stores/trips';
	import AsyncErrorBoundary from '$lib/components/AsyncErrorBoundary.svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { user } from '$lib/stores/auth';

	const resolve = (href: string) => `${base}${href}`;
	import { page } from '$app/stores';
	import { toasts } from '$lib/stores/toast';
	import { onMount, onDestroy } from 'svelte';
	import { calculateNetProfit } from '$lib/utils/trip-helpers';

	// Import Components
	import TripStats from './components/TripStats.svelte';
	import TripFilters from './components/TripFilters.svelte';
	import TripCard from './components/TripCard.svelte';
	import ActionBar from './components/ActionBar.svelte';
	import SettingsModal from './components/SettingsModal.svelte';
	import UpgradeModal from './components/UpgradeModal.svelte';

	let tripsBoundary: any;
	let hasLoadedOnce = false;
	let isMounted = false;
	let lastHadSelections = false;

	// Filter State
	let searchQuery = '';
	let sortBy = 'date';
	let sortOrder = 'desc';
	let filterProfit = 'all';
	// Default to current month (first day to last day)
	const _now = new Date();
	function _fmtInput(d: Date) {
		return d.toISOString().slice(0, 10);
	}
	let startDate = _fmtInput(new Date(_now.getFullYear(), _now.getMonth(), 1));
	let endDate = _fmtInput(new Date(_now.getFullYear(), _now.getMonth() + 1, 0));

	// Pagination
	let currentPage = 1;
	const itemsPerPage = 20;

	// Selection
	let selectedTrips = new Set<string>();

	// Modals
	let isSettingsOpen = false;
	let isUpgradeModalOpen = false;

	$: isPro = ['pro', 'business', 'premium', 'enterprise'].includes($user?.plan || '');
	$: API_KEY = $page.data['googleMapsApiKey'];

	// Reset page when filters change
	$: if (searchQuery || sortBy || sortOrder || filterProfit || startDate || endDate) {
		currentPage = 1;
	}

	async function loadTrips() {
		try {
			if ($trips.length > 0) {
				tripsBoundary?.setSuccess();
				return;
			}
			if (!hasLoadedOnce) tripsBoundary?.setLoading();
			await trips.load();
			hasLoadedOnce = true;
			tripsBoundary?.setSuccess();
		} catch (error) {
			console.error('Failed to load trips:', error);
			tripsBoundary?.setError(error as Error);
			toasts.error('Failed to load trips. Click retry to try again.');
			throw error;
		}
	}

	// Handle body class for selection bar
	$: if (typeof document !== 'undefined' && isMounted) {
		const hasSelections = selectedTrips.size > 0;
		if (hasSelections !== lastHadSelections) {
			if (hasSelections) document.body.classList.add('has-selections');
			else document.body.classList.remove('has-selections');
			lastHadSelections = hasSelections;
		}
	}

	onMount(() => {
		document.body.classList.remove('has-selections');
		isMounted = true;
		loadTrips();
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.classList.remove('has-selections');
		isMounted = false;
	});

	// --- Filtering Logic ---
	$: allFilteredTrips = $trips
		.filter((trip) => {
			const query = searchQuery.toLowerCase();
			const supplies = (trip as any)['supplyItems'] || (trip as any)['suppliesItems'] || [];
			const matchesSearch =
				!query ||
				trip.date?.includes(query) ||
				trip.startAddress?.toLowerCase().includes(query) ||
				trip.endAddress?.toLowerCase().includes(query) ||
				trip.notes?.toLowerCase().includes(query) ||
				trip.totalMiles?.toString().includes(query) ||
				trip.fuelCost?.toString().includes(query) ||
				trip.stops?.some(
					(stop: any) =>
						stop.address?.toLowerCase().includes(query) || stop.earnings?.toString().includes(query)
				) ||
				(trip as any)['maintenanceItems']?.some(
					(item: any) =>
						item.type?.toLowerCase().includes(query) || item.cost?.toString().includes(query)
				) ||
				supplies.some(
					(item: any) =>
						item.type?.toLowerCase().includes(query) || item.cost?.toString().includes(query)
				);

			if (!matchesSearch) return false;

			if (filterProfit !== 'all') {
				const profit = calculateNetProfit(trip);
				if (filterProfit === 'positive' && profit <= 0) return false;
				if (filterProfit === 'negative' && profit >= 0) return false;
			}

			if (trip.date) {
				const tripDate = new Date(trip.date);
				tripDate.setHours(0, 0, 0, 0);
				if (startDate) {
					const start = new Date(startDate);
					start.setHours(0, 0, 0, 0);
					if (tripDate < start) return false;
				}
				if (endDate) {
					const end = new Date(endDate);
					end.setHours(0, 0, 0, 0);
					if (tripDate > end) return false;
				}
			}
			return true;
		})
		.sort((a, b) => {
			let aVal, bVal;
			switch (sortBy) {
				case 'date':
					aVal = new Date(a.date || 0).getTime();
					bVal = new Date(b.date || 0).getTime();
					break;
				case 'profit':
					aVal = calculateNetProfit(a);
					bVal = calculateNetProfit(b);
					break;
				case 'miles':
					aVal = a.totalMiles || 0;
					bVal = b.totalMiles || 0;
					break;
				default:
					return 0;
			}
			return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
		});

	$: totalPages = Math.ceil(allFilteredTrips.length / itemsPerPage);
	$: visibleTrips = allFilteredTrips.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);
	$: allSelected = allFilteredTrips.length > 0 && selectedTrips.size === allFilteredTrips.length;

	function toggleSelection(id: string) {
		if (selectedTrips.has(id)) selectedTrips.delete(id);
		else selectedTrips.add(id);
		selectedTrips = selectedTrips;
	}

	function toggleSelectAll() {
		if (allSelected) selectedTrips = new Set();
		else selectedTrips = new Set(allFilteredTrips.map((t) => t.id));
	}

	function changePage(newPage: number) {
		if (newPage >= 1 && newPage <= totalPages) {
			currentPage = newPage;
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	}

	async function deleteTrip(id: string) {
		if (!confirm('Move trip to trash?')) return;
		try {
			const trip = $trips.find((t) => t.id === id);
			const currentUser = $page.data['user'] || $user;

			// [!code fix] Strictly use ID. Removed fallback to name/token and legacy legacy checks.
			const userId = currentUser?.id || localStorage.getItem('offline_user_id') || '';

			if (userId) await trips.deleteTrip(id, userId as string);
		} catch (err) {
			toasts.error('Failed to delete trip. Changes reverted.');
		}
	}

	async function deleteSelected() {
		const count = selectedTrips.size;
		if (!confirm(`Are you sure you want to delete ${count} trip(s)?`)) return;
		const currentUser = $page.data['user'] || $user;

		// [!code fix] Strictly use ID.
		const userId = currentUser?.id || localStorage.getItem('offline_user_id') || '';

		if (!userId) {
			toasts.error('User identity missing.');
			return;
		}

		let successCount = 0;
		const ids = Array.from(selectedTrips);
		for (const id of ids) {
			try {
				await trips.deleteTrip(id, userId);
				successCount++;
			} catch (err) {
				console.error(`Failed to delete trip ${id}`, err);
			}
		}
		toasts.success(`Moved ${successCount} trips to trash.`);
		selectedTrips = new Set();
	}

	function exportSelected() {
		if (typeof document === 'undefined' || typeof window === 'undefined') return;
		const selectedData = allFilteredTrips.filter((t) => selectedTrips.has(t.id));
		if (selectedData.length === 0) return;
		const headers = ['Date', 'Start', 'End', 'Miles', 'Profit', 'Notes'];
		const rows = selectedData.map((t) => {
			const profit = calculateNetProfit(t);
			return [
				t.date,
				`"${t.startAddress}"`,
				`"${t.endAddress}"`,
				t.totalMiles,
				profit.toFixed(2),
				`"${(t.notes || '').replace(/"/g, '""')}"`
			].join(',');
		});
		const csvContent = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `trips_export_${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		toasts.success(`Exported ${selectedData.length} trips.`);
		selectedTrips = new Set();
	}

	let expandedTrips = new Set<string>();
	function toggleExpand(id: string) {
		if (expandedTrips.has(id)) expandedTrips.delete(id);
		else expandedTrips.add(id);
		expandedTrips = expandedTrips;
	}

	// Auto-expand a trip when `?id=<tripId>` is present in URL — used when navigating from expenses
	let lastQueryExpandId = '';
	$: {
		const qId = $page?.url?.searchParams.get('id');
		if (qId && qId !== lastQueryExpandId && allFilteredTrips?.length > 0) {
			const idx = allFilteredTrips.findIndex((t) => t.id === qId);
			if (idx !== -1) {
				const newPage = Math.floor(idx / itemsPerPage) + 1;
				if (currentPage !== newPage) currentPage = newPage;
				expandedTrips = new Set([qId]);
				if (typeof document !== 'undefined') {
					setTimeout(() => {
						const el = document.getElementById('trip-' + qId);
						if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 60);
				}
			}
			lastQueryExpandId = qId;
		}
	}
</script>

<svelte:head>
	<title>Trips - Go Route Yourself</title>
	<style>
		/* FORCE OVERRIDE: Google Maps Autocomplete z-index */
		.pac-container {
			z-index: 2147483647 !important;
			/* Positioning removed to allow the action to control absolute/fixed placement */
			pointer-events: auto !important;
		}
	</style>
</svelte:head>

<AsyncErrorBoundary bind:this={tripsBoundary} onRetry={loadTrips}>
	<div class="trip-history">
		<div class="page-header">
			<div class="header-text">
				<h1 class="page-title">Trips</h1>
				<p class="page-subtitle">View and manage all your trips</p>
			</div>

			<div class="header-actions">
				<button
					class="btn-secondary"
					onclick={() => goto(resolve('/dashboard/trash'))}
					aria-label="View Trash"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><polyline points="3 6 5 6 21 6"></polyline><path
							d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
						></path></svg
					>
				</button>
				<button
					class="btn-secondary"
					onclick={() => (isSettingsOpen = true)}
					aria-label="Trip Settings"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path
							d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
						></path><circle cx="12" cy="12" r="3"></circle></svg
					>
				</button>
				<a href={resolve('/dashboard/trips/new')} class="btn-primary" aria-label="Create New Trip">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"
						><path
							d="M10 4V16M4 10H16"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
					New Trip
				</a>
			</div>
		</div>

		<TripStats trips={allFilteredTrips} />

		<TripFilters
			bind:searchQuery
			bind:startDate
			bind:endDate
			bind:filterProfit
			bind:sortBy
			bind:sortOrder
		/>

		{#if visibleTrips.length > 0}
			<div class="batch-header" class:visible={allFilteredTrips.length > 0}>
				<label class="checkbox-container">
					<input type="checkbox" checked={allSelected} onchange={toggleSelectAll} />
					<span class="checkmark"></span>
					Select All ({allFilteredTrips.length})
				</label>
				<span class="page-info">Showing {visibleTrips.length} of {allFilteredTrips.length}</span>
			</div>

			<div class="trip-list-cards">
				{#each visibleTrips as trip (trip.id)}
					<TripCard
						{trip}
						isExpanded={expandedTrips.has(trip.id)}
						isSelected={selectedTrips.has(trip.id)}
						on:toggleExpand={() => toggleExpand(trip.id)}
						on:toggleSelection={() => toggleSelection(trip.id)}
						on:edit={() => goto(resolve(`/dashboard/trips/edit/${trip.id}`))}
						on:delete={() => deleteTrip(trip.id)}
					/>
				{/each}
			</div>

			{#if totalPages > 1}
				<div class="pagination-controls">
					<button
						class="page-btn"
						disabled={currentPage === 1}
						onclick={() => changePage(currentPage - 1)}>← Prev</button
					>
					<span class="page-status">Page {currentPage} of {totalPages}</span>
					<button
						class="page-btn"
						disabled={currentPage === totalPages}
						onclick={() => changePage(currentPage + 1)}>Next →</button
					>
				</div>
			{/if}
		{:else}
			<div class="empty-state">
				<p>No trips found matching your filters.</p>
			</div>
		{/if}
	</div>

	{#if selectedTrips.size > 0}
		<ActionBar
			selectedCount={selectedTrips.size}
			{isPro}
			on:cancel={() => (selectedTrips = new Set())}
			on:export={exportSelected}
			on:delete={deleteSelected}
		/>
	{/if}

	<SettingsModal bind:open={isSettingsOpen} {API_KEY} />
	<UpgradeModal bind:open={isUpgradeModalOpen} />

	{#snippet loading()}
		<div class="trips-loading">
			<div class="loading-header">
				<div class="skeleton skeleton-title"></div>
				<div class="skeleton skeleton-button"></div>
			</div>
			<div class="loading-stats">
				{#each Array(4) as _}<div class="skeleton skeleton-stat"></div>{/each}
			</div>
			<div class="loading-filters">
				<div class="skeleton skeleton-input"></div>
				<div class="skeleton skeleton-select"></div>
			</div>
			<div class="trip-list-cards">
				{#each Array(6) as _}<div class="trip-skeleton">
						<div class="skeleton-top">
							<div class="skeleton skeleton-text" style="width: 30%; height: 14px;"></div>
							<div
								class="skeleton skeleton-text"
								style="width: 60%; height: 18px; margin-top: 8px;"
							></div>
						</div>
						<div class="skeleton-stats-grid">
							{#each Array(5) as _}<div>
									<div
										class="skeleton skeleton-text"
										style="width: 80%; height: 10px; margin-bottom: 4px;"
									></div>
									<div class="skeleton skeleton-text" style="width: 50%; height: 14px;"></div>
								</div>{/each}
						</div>
					</div>{/each}
			</div>
		</div>
	{/snippet}

	{#snippet error({ error, retry })}
		<div class="trips-error">
			<div class="error-content">
				<div class="error-icon">
					<svg
						width="64"
						height="64"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line
							x1="12"
							y1="16"
							x2="12.01"
							y2="16"
						/></svg
					>
				</div>
				<h2>Failed to Load Trips</h2>
				<p class="error-message">
					{#if error.message.includes('fetch') || error.message.includes('Failed to fetch')}
						Unable to connect to the server. Please check your internet connection and try again.
					{:else if error.message.includes('401') || error.message.includes('Unauthorized')}
						Your session has expired. Please <a href={resolve('/login')}>log in again</a>.
					{:else if error.message.includes('403') || error.message.includes('Forbidden')}
						You don't have permission to view trips. Please contact support if this persists.
					{:else if error.message.includes('500')}
						A server error occurred. Our team has been notified. Please try again in a few moments.
					{:else}
						{error.message}
					{/if}
				</p>
				<div class="error-actions">
					<button onclick={retry} class="btn-primary"
						><svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							><polyline points="23 4 23 10 17 10" /><path
								d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
							/></svg
						> Try Again</button
					>
					<a href={resolve('/dashboard')} class="btn-secondary">Go to Dashboard</a>
				</div>
				<details class="error-details">
					<summary>Technical Details</summary>
					<pre><code
							>{JSON.stringify(
								{
									message: error.message,
									time: new Date().toISOString(),
									path: $page.url.pathname,
									userAgent: navigator.userAgent
								},
								null,
								2
							)}</code
						></pre>
				</details>
			</div>
		</div>
	{/snippet}
</AsyncErrorBoundary>

<style>
	.trip-history {
		max-width: 1400px;
		margin: 0 auto;
		padding: 16px;
		padding-bottom: 80px;
	}
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.page-title {
		font-size: 24px;
		font-weight: 800;
		color: #111827;
		margin: 0;
	}
	.page-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}
	.header-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		background: linear-gradient(135deg, #ff7f50 0%, #ff6a3d 100%);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
		text-decoration: none;
		box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3);
		transition: transform 0.1s;
		cursor: pointer;
	}
	.btn-primary:active {
		transform: translateY(1px);
	}
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 10px;
		background: white;
		border: 1px solid #e5e7eb;
		color: #374151;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.2s;
		text-decoration: none;
	}
	.batch-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
		padding: 0 4px;
		color: #6b7280;
		font-size: 13px;
		font-weight: 500;
	}
	.checkbox-container {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		color: #4b5563;
		position: relative;
		padding-left: 28px;
		user-select: none;
	}
	.checkbox-container input {
		position: absolute;
		opacity: 0;
		cursor: pointer;
		height: 0;
		width: 0;
	}
	.checkmark {
		position: absolute;
		top: 0;
		left: 0;
		height: 20px;
		width: 20px;
		background-color: white;
		border: 2px solid #d1d5db;
		border-radius: 6px;
		transition: all 0.2s;
	}
	.checkbox-container:hover input ~ .checkmark {
		border-color: #9ca3af;
	}
	.checkbox-container input:checked ~ .checkmark {
		background-color: #ff7f50;
		border-color: #ff7f50;
	}
	.checkmark:after {
		content: '';
		position: absolute;
		display: none;
	}
	.checkbox-container input:checked ~ .checkmark:after {
		display: block;
	}
	.checkbox-container .checkmark:after {
		left: 6px;
		top: 2px;
		width: 5px;
		height: 10px;
		border: solid white;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.trip-list-cards {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.pagination-controls {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 16px;
		margin-top: 32px;
	}
	.page-btn {
		padding: 8px 16px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
		color: #374151;
		cursor: pointer;
		transition: all 0.2s;
	}
	.page-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.page-status {
		font-size: 14px;
		color: #4b5563;
		font-weight: 500;
	}
	.empty-state {
		text-align: center;
		padding: 40px 20px;
		color: #6b7280;
		font-size: 15px;
	}

	/* Loading state styles */
	.trips-loading {
		padding: 2rem;
		animation: fadeIn 0.3s ease-out;
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.loading-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.loading-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
		margin-bottom: 24px;
	}
	.loading-filters {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 20px;
	}
	.skeleton {
		background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		border-radius: 0.5rem;
	}
	.skeleton-title {
		width: 200px;
		height: 2rem;
	}
	.skeleton-button {
		width: 120px;
		height: 2.5rem;
	}
	.skeleton-stat {
		height: 80px;
		border-radius: 12px;
	}
	.skeleton-input {
		flex: 1;
		height: 2.5rem;
	}
	.skeleton-select {
		width: 150px;
		height: 2.5rem;
	}
	.trip-skeleton {
		background: white;
		padding: 1.5rem;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
	}
	.skeleton-top {
		margin-bottom: 1rem;
	}
	.skeleton-text {
		height: 1rem;
		margin-bottom: 0.5rem;
		background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		border-radius: 0.25rem;
	}
	.skeleton-stats-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}
	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* Error state styles */
	.trips-error {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 2rem;
		animation: fadeIn 0.3s ease-out;
	}
	.error-content {
		text-align: center;
		max-width: 500px;
	}
	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 80px;
		height: 80px;
		background: #fee2e2;
		border-radius: 50%;
		color: #dc2626;
		margin-bottom: 1.5rem;
	}
	.trips-error h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: #111827;
		margin: 0 0 0.5rem;
	}
	.error-message {
		color: #6b7280;
		margin: 0 0 2rem;
		line-height: 1.6;
	}
	.error-message a {
		color: #ff7f50;
		text-decoration: underline;
		font-weight: 600;
	}
	.error-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 2rem;
	}
	.error-details {
		margin-top: 2rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 0.5rem;
		text-align: left;
	}
	.error-details summary {
		cursor: pointer;
		color: #6b7280;
		font-size: 0.875rem;
		font-weight: 500;
		user-select: none;
	}
	.error-details summary:hover {
		color: #374151;
	}
	.error-details pre {
		margin-top: 0.5rem;
		padding: 0.75rem;
		background: #1f2937;
		color: #f3f4f6;
		border-radius: 0.375rem;
		overflow-x: auto;
		font-size: 0.75rem;
		line-height: 1.5;
	}

	@media (hover: hover) {
		.btn-secondary:hover {
			background: #f9fafb;
		}
		.page-btn:hover:not(:disabled) {
			border-color: #ff7f50;
			color: #ff7f50;
		}
	}
	@media (min-width: 640px) {
		.loading-stats {
			grid-template-columns: repeat(4, 1fr);
		}
		.loading-filters {
			flex-direction: row;
		}
		.skeleton-stats-grid {
			grid-template-columns: repeat(5, 1fr);
		}
		.error-actions {
			flex-direction: row;
			justify-content: center;
		}
	}

	:global(body.has-selections .mobile-footer),
	:global(body.has-selections footer),
	:global(body.has-selections nav[class*='mobile']),
	:global(body.has-selections .bottom-nav) {
		display: none !important;
	}

	@media (max-width: 640px) {
		/* Keep only the safe-area inset plus a small buffer so content sits close to the bottom nav */
		.trip-history {
			padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1px);
		}

		/* Slightly compact card spacing on small screens */
		.trip-list-cards {
			gap: 8px;
		}

		/* Reduce extra space above pagination on mobile */
		.pagination-controls {
			margin-top: 16px;
		}

		/* Compact empty-state padding on mobile */
		.empty-state {
			padding: 24px 12px;
		}
	}
</style>
