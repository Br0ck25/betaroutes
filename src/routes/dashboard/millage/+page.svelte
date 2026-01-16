<script lang="ts">
	import { millage, isLoading as millageLoading } from '$lib/stores/millage';
	import { trips, isLoading as tripsLoading } from '$lib/stores/trips';
	import { userSettings } from '$lib/stores/userSettings';
	import SettingsModal from './components/SettingsModal.svelte';
	import { user } from '$lib/stores/auth';
	import { toasts } from '$lib/stores/toast';

	let isMillageSettingsOpen = false;
	import Modal from '$lib/components/ui/Modal.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	// Derived totals for millage (use safe casting where needed)
	$: totalMiles = filteredExpenses.reduce((s, e) => s + (Number((e as any).miles) || 0), 0);
	$: totalReimbursement = filteredExpenses.reduce(
		(s, e) => s + (Number((e as any).reimbursement) || 0),
		0
	);

	// --- STATE ---
	let searchQuery = '';
	let sortBy = 'date';
	let sortOrder = 'desc';
	let filterCategory = 'all';
	let allExpenses: any[] = [];
	let filteredExpenses: any[] = [];
	// Default to current year (Jan 1 -> today)
	const _now = new Date();
	function _fmtInput(d: Date) {
		return d.toISOString().slice(0, 10);
	}
	let startDate = _fmtInput(new Date(_now.getFullYear(), 0, 1));
	let endDate = _fmtInput(_now);
	let lastHadSelections = false;

	// Selection State
	let selectedExpenses = new Set<string>();
	// Render a small slice of the list initially to reduce initial DOM work and main-thread blocking.
	// We'll expand to the full list when the browser is idle or after loading finishes.
	let visibleLimit = 20;
	let visibleExpenses: any[] = [];
	$: visibleExpenses = filteredExpenses.slice(0, visibleLimit);
	// Expand visible window when more items become available (guarded to avoid reactive loops)
	let _lastExpandedSize = 0;
	// non-reactive guard variable
	/* eslint-disable svelte/infinite-reactive-loop */
	$: if (
		!loading &&
		typeof window !== 'undefined' &&
		filteredExpenses.length > visibleLimit &&
		filteredExpenses.length !== _lastExpandedSize
	) {
		const size = filteredExpenses.length;
		_lastExpandedSize = size;
		if ('requestIdleCallback' in window) {
			requestIdleCallback(() => (visibleLimit = size));
		} else {
			setTimeout(() => (visibleLimit = size), 200);
		}
	}
	/* eslint-enable svelte/infinite-reactive-loop */

	$: if (typeof document !== 'undefined') {
		const hasSelections = selectedExpenses.size > 0;
		if (hasSelections !== lastHadSelections) {
			if (hasSelections) {
				document.body.classList.add('has-selections');
			} else {
				document.body.classList.remove('has-selections');
			}
			lastHadSelections = hasSelections;
		}
	}

	// Clean up body class when component is destroyed
	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.body.classList.remove('has-selections');
		}
	});
	// Categories intentionally empty for Millage page
	let categories: string[] = [];
	// --- MODAL STATE (Only for Categories now) ---
	let isManageCategoriesOpen = false;
	let newCategoryName = '';
	// --- DERIVE TRIP EXPENSES ---
	$: tripExpenses = $trips.flatMap((trip) => {
		const items = [];
		// FIX: Safely access createdAt to prevent split() on undefined
		const date =
			trip.date || (trip.createdAt ? trip.createdAt.split('T')[0] : _fmtInput(new Date()));

		// Trip-derived expenses intentionally excluded from Millage listing
		// (Fuel/maintenance/supplies from trips are shown under Expenses, not Millage)
		// This avoids duplicating expense entries across both lists.

		// 2. Maintenance Items removed for Millage page (excluded)
		// (maintenance entries are intentionally omitted from millage listing)

		// 3. Supply Items removed for Millage page (excluded)
		// (supply entries are intentionally omitted from millage listing)

		return items;
	});
	// --- COMBINE & FILTER ---
	$: allExpenses = [
		...$millage.filter(
			(r) =>
				typeof (r as any).miles === 'number' ||
				typeof (r as any).startOdometer === 'number' ||
				typeof (r as any).endOdometer === 'number'
		),
		...tripExpenses
	];
	// Reset selection when filters change
	$: if (searchQuery || sortBy || sortOrder || filterCategory || startDate || endDate) {
		selectedExpenses = new Set();
	}

	$: filteredExpenses = allExpenses
		.filter((item) => {
			// Search (safe casts)
			const query = searchQuery.toLowerCase();
			const matchesSearch =
				!query ||
				((item as any).description && (item as any).description.toLowerCase().includes(query)) ||
				String((item as any).amount || '').includes(query) ||
				((item as any).source === 'trip' && 'trip log'.includes(query));

			if (!matchesSearch) return false;

			// Category
			if (filterCategory !== 'all' && item.category !== filterCategory) return false;

			// Date Range
			if (item.date) {
				const itemDate = new Date(item.date);
				itemDate.setHours(0, 0, 0, 0);

				if (startDate) {
					const start = new Date(startDate);
					start.setHours(0, 0, 0, 0);
					if (itemDate < start) return false;
				}
				if (endDate) {
					const end = new Date(endDate);
					end.setHours(0, 0, 0, 0);
					if (itemDate > end) return false;
				}
			}

			return true;
		})
		.sort((a, b) => {
			let aVal: number = 0,
				bVal: number = 0;
			if (sortBy === 'date') {
				aVal = new Date((a as any).date || 0).getTime();
				bVal = new Date((b as any).date || 0).getTime();
			} else {
				aVal = Number((a as any).amount || 0);
				bVal = Number((b as any).amount || 0);
			}
			return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
		});

	$: loading = $millageLoading || $tripsLoading;
	// switched to millage store
	$: allSelected = filteredExpenses.length > 0 && selectedExpenses.size === filteredExpenses.length;

	// --- ACTIONS ---
	function goToAdd() {
		goto('/dashboard/millage/new');
	} // open millage new form

	function editExpense(expense: any) {
		if ((expense as any).source === 'trip') {
			goto(`/dashboard/trips?id=${expense.tripId}`);
		} else {
			goto(`/dashboard/millage/edit/${expense.id}`);
		}
	}

	async function deleteExpense(id: string, e?: MouseEvent) {
		if (e) e.stopPropagation();
		if (!confirm('Move this expense to trash? You can restore it later.')) return;
		// Check if it's a trip log
		if (id.startsWith('trip-')) {
			toasts.error('Cannot delete Trip Logs here. Delete the Trip instead.');
			return;
		}

		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
		if (userId) {
			try {
				await millage.deleteMillage(id, String(userId));
				toasts.success('Log moved to trash');
				if (selectedExpenses.has(id)) {
					selectedExpenses.delete(id);
					selectedExpenses = selectedExpenses;
				}
			} catch (err) {
				console.error(err);
				toasts.error('Failed to move to trash');
			}
		}
	}

	// --- SELECTION LOGIC ---
	function toggleSelection(id: string) {
		if (selectedExpenses.has(id)) selectedExpenses.delete(id);
		else selectedExpenses.add(id);
		selectedExpenses = selectedExpenses;
	}

	function toggleSelectAll() {
		if (allSelected) selectedExpenses = new Set();
		else selectedExpenses = new Set(filteredExpenses.map((e) => e.id));
	}

	async function deleteSelected() {
		const ids = Array.from(selectedExpenses);
		const manualExpenses = ids.filter((id) => !id.startsWith('trip-'));
		const tripLogs = ids.length - manualExpenses.length;
		if (manualExpenses.length === 0 && tripLogs > 0) {
			toasts.error(`Cannot delete ${tripLogs} Trip Logs. Edit them in Trips.`);
			return;
		}

		if (
			!confirm(
				`Move ${manualExpenses.length} expenses to trash? ${tripLogs > 0 ? `(${tripLogs} trip logs will be skipped)` : ''}`
			)
		)
			return;
		const currentUser = $page.data['user'] || $user;
		const userId =
			currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');

		if (!userId) return;

		let successCount = 0;
		for (const id of manualExpenses) {
			try {
				await millage.deleteMillage(id, String(userId));
				successCount++;
			} catch (err) {
				console.error(`Failed to delete ${id}`, err);
			}
		}

		toasts.success(`Moved ${successCount} logs to trash.`);
		selectedExpenses = new Set();
	}

	function isTripSource(item: any): boolean {
		return (item as any)?.source === 'trip';
	}

	function exportSelected() {
		const selectedData = filteredExpenses.filter((e) => selectedExpenses.has(e.id));
		if (selectedData.length === 0) return;
		const headers = ['Date', 'Miles', 'Reimbursement', 'Notes', 'Source'];
		const rows = selectedData.map((e) =>
			[
				(e as any).date || '',
				((e as any).miles ?? 0).toFixed(2),
				((e as any).reimbursement || '').toString(),
				`"${(((e as any).notes || '') as string).replace(/"/g, '""')}"`,
				'Manual'
			].join(',')
		);

		const csvContent = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `expenses_export_${new Date().toISOString().split('T')[0]}.csv`;
		a.click();

		toasts.success(`Exported ${selectedData.length} items.`);
		selectedExpenses = new Set();
	}

	// --- CATEGORY MANAGEMENT ---
	async function updateCategories(newCategories: string[]) {
		userSettings.update((s) => ({ ...s, expenseCategories: newCategories }));
		try {
			const { saveSettings } = await import('../settings/lib/save-settings');
			const result = await saveSettings({ expenseCategories: newCategories });
			if (!result.ok) throw new Error(result.error);
		} catch (e) {
			console.error('Failed to sync settings', e);
			toasts.error('Saved locally, but sync failed');
		}
	}

	async function addCategory() {
		if (!newCategoryName.trim()) return;
		const val = newCategoryName.trim().toLowerCase();
		if (categories.includes(val)) {
			toasts.error('Category already exists');
			return;
		}
		const updated = [...categories, val];
		await updateCategories(updated);
		newCategoryName = '';
		toasts.success('Category added');
	}

	async function removeCategory(cat: string) {
		if (!confirm(`Delete "${cat}" category? Existing expenses will keep this category.`)) return;
		const updated = categories.filter((c) => c !== cat);
		await updateCategories(updated);
		toasts.success('Category removed');
	}

	// --- HELPERS ---
	function formatCurrency(amount: number) {
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '';
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}

	function getCategoryLabel(cat: string) {
		if (!cat) return '';
		return cat.charAt(0).toUpperCase() + cat.slice(1);
	}

	function getCategoryColor(cat?: string) {
		// FIX: Handle undefined/missing category (e.g. for Millage records)
		if (!cat) return 'text-gray-600 bg-gray-50 border-gray-200';

		if (cat === 'fuel') return 'text-red-600 bg-red-50 border-red-200';
		const colors = [
			'text-blue-600 bg-blue-50 border-blue-200',
			'text-purple-600 bg-purple-50 border-purple-200',
			'text-orange-600 bg-orange-50 border-orange-200',
			'text-green-600 bg-green-50 border-green-200',
			'text-pink-600 bg-pink-50 border-pink-200',
			'text-indigo-600 bg-indigo-50 border-indigo-200'
		];
		if (cat === 'supplies') return colors[2];
		const sum = cat.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		return colors[sum % colors.length];
	}

	// Swipe Action
	function swipeable(
		node: HTMLElement,
		{
			onEdit,
			onDelete,
			isReadOnly
		}: { onEdit: () => void; onDelete: (e: any) => void; isReadOnly: boolean }
	) {
		if (isReadOnly) return;
		let startX = 0;
		let x = 0;
		let swiping = false;

		function handleTouchStart(e: TouchEvent) {
			const touch = e.touches?.[0];
			if (!touch) return;
			startX = touch.clientX;
			x = 0;
			node.style.transition = 'none';
		}

		function handleTouchMove(e: TouchEvent) {
			const touch = e.touches?.[0];
			if (!touch) return;
			const dx = touch.clientX - startX;
			swiping = true;
			if (dx < -120) x = -120;
			else if (dx > 120) x = 120;
			else x = dx;
			node.style.transform = `translateX(${x}px)`;
			if (Math.abs(x) > 10) e.preventDefault();
		}

		function handleTouchEnd() {
			if (!swiping) return;
			swiping = false;
			node.style.transition = 'transform 0.2s ease-out';
			if (x < -80) onDelete({ stopPropagation: () => {} });
			else if (x > 80) onEdit();
			node.style.transform = 'translateX(0)';
		}

		node.addEventListener('touchstart', handleTouchStart, { passive: false });
		node.addEventListener('touchmove', handleTouchMove, { passive: false });
		node.addEventListener('touchend', handleTouchEnd);
		return {
			destroy() {
				node.removeEventListener('touchstart', handleTouchStart);
				node.removeEventListener('touchmove', handleTouchMove);
				node.removeEventListener('touchend', handleTouchEnd);
			}
		};
	}
</script>

<svelte:head>
	<title>Millage Log - Go Route Yourself</title>
</svelte:head>

<div class="page-container">
	<div class="page-header">
		<div class="header-text">
			<h1 class="page-title">Millage</h1>
			<p class="page-subtitle">Log odometer readings and miles</p>
		</div>

		<div class="header-actions">
			<button
				class="btn-secondary"
				on:click={() => goto('/dashboard/trash?type=millage')}
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
				>
					<polyline points="3 6 5 6 21 6"></polyline>
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
					></path>
				</svg>
			</button>
			<button
				class="btn-secondary"
				title="Millage Settings"
				on:click={() => (isMillageSettingsOpen = true)}
				aria-label="Millage Settings"
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
					><circle cx="12" cy="12" r="3"></circle><path
						d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 
2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 
0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
					></path></svg
				>
			</button>
			<SettingsModal bind:open={isMillageSettingsOpen} />

			<button class="btn-primary" on:click={goToAdd}>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
					<path
						d="M10 4V16M4 10H16"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				New Millage
			</button>
		</div>
	</div>

	<div class="stats-summary">
		<div class="summary-card">
			<div class="summary-label">Total Logs</div>
			<div class="summary-value">{filteredExpenses.length}</div>
		</div>

		<div class="summary-card">
			<div class="summary-label">Total Miles</div>
			<div class="summary-value">{totalMiles.toFixed(2)} mi</div>
		</div>

		<div class="summary-card">
			<div class="summary-label">Total Reimbursement</div>
			<div class="summary-value">{formatCurrency(totalReimbursement)}</div>
		</div>

		{#if categories[0]}
			<div class="summary-card hidden-mobile">
				<div class="summary-label">{getCategoryLabel(categories[0])}</div>
				<div class="summary-value">
					{formatCurrency(
						filteredExpenses
							.filter((e) => e.category === categories[0])
							.reduce((s, e) => s + e.amount, 0)
					)}
				</div>
			</div>
		{/if}
		{#if categories[1]}
			<div class="summary-card hidden-mobile">
				<div class="summary-label">{getCategoryLabel(categories[1])}</div>
				<div class="summary-value">
					{formatCurrency(
						filteredExpenses
							.filter((e) => e.category === categories[1])
							.reduce((s, e) => s + e.amount, 0)
					)}
				</div>
			</div>
		{/if}
	</div>

	<div class="filters-bar sticky-bar">
		<div class="search-box">
			<svg class="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M19 19L14.65 14.65"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			<input
				id="search-expenses"
				name="searchQuery"
				type="text"
				placeholder="Search millage logs..."
				bind:value={searchQuery}
			/>
		</div>

		<div class="filter-group date-group">
			<input
				id="start-date"
				name="startDate"
				type="date"
				bind:value={startDate}
				class="date-input"
				aria-label="Start Date"
			/>
			<span class="date-sep">-</span>
			<input
				id="end-date"
				name="endDate"
				type="date"
				bind:value={endDate}
				class="date-input"
				aria-label="End Date"
			/>
		</div>

		<div class="filter-group">
			<select
				id="filter-category"
				name="filterCategory"
				bind:value={filterCategory}
				class="filter-select"
				aria-label="Filter by category"
			>
				<option value="all">All Categories</option>
				{#each categories as cat}
					<option value={cat}>{getCategoryLabel(cat)}</option>
				{/each}
				<option value="fuel">Fuel (Trips)</option>
			</select>

			<select
				id="sort-by"
				name="sortBy"
				bind:value={sortBy}
				class="filter-select"
				aria-label="Sort results"
			>
				<option value="date">By Date</option>
				<option value="amount">By Cost</option>
			</select>

			<button
				class="sort-btn"
				aria-label="Toggle sort order"
				on:click={() => (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')}
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 20 20"
					fill="none"
					style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})"
				>
					<path
						d="M10 3V17M10 17L4 11M10 17L16 11"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</div>
	</div>

	{#if filteredExpenses.length > 0}
		<div class="batch-header" class:visible={filteredExpenses.length > 0}>
			<label class="checkbox-container">
				<input
					id="select-all"
					name="selectAll"
					type="checkbox"
					checked={allSelected}
					on:change={toggleSelectAll}
				/>
				<span class="checkmark"></span>
				Select All ({filteredExpenses.length})
			</label>

			<span class="page-info">Showing {filteredExpenses.length} items</span>
		</div>
	{/if}

	{#if loading}
		<div class="expense-list-cards">
			{#each Array(3) as _}
				<div class="expense-card">
					<div class="card-top">
						<div style="flex: 1">
							<Skeleton height="16px" width="30%" className="mb-2" />
							<Skeleton height="20px" width="60%" />
						</div>
						<Skeleton height="24px" width="60px" />
					</div>
				</div>
			{/each}
		</div>
	{:else if filteredExpenses.length > 0}
		<div class="expense-list-cards">
			{#each visibleExpenses as expense (expense.id)}
				{@const isSelected = selectedExpenses.has(expense.id)}
				<div class="card-wrapper">
					{#if !isTripSource(expense)}
						<div class="swipe-bg">
							<div class="swipe-action edit"><span>Edit</span></div>
							<div class="swipe-action delete"><span>Trash</span></div>
						</div>
					{/if}

					<div
						class="expense-card"
						class:read-only={isTripSource(expense)}
						class:selected={isSelected}
						on:click={() => editExpense(expense)}
						role="button"
						tabindex="0"
						on:keypress={(e) => e.key === 'Enter' && editExpense(expense)}
						use:swipeable={{
							onEdit: () => editExpense(expense),
							onDelete: (e) => deleteExpense(expense.id, e),
							isReadOnly: isTripSource(expense)
						}}
					>
						<div class="card-top">
							<div
								class="selection-box"
								on:click|stopPropagation
								on:keydown|stopPropagation
								role="none"
							>
								<label class="checkbox-container">
									<input
										type="checkbox"
										id={'expense-' + expense.id + '-checkbox'}
										name="selectedExpense"
										value={expense.id}
										aria-labelledby={'expense-' + expense.id + '-title'}
										checked={isSelected}
										on:change={() => toggleSelection(expense.id)}
									/>
									<span class="checkmark"></span>
								</label>
							</div>

							<div class="expense-main-info">
								<span class="expense-date-display">
									{formatDate(expense.date || '')}
								</span>

								<h2 class="expense-desc-title" id={'expense-' + expense.id + '-title'}>
									{expense.notes ||
										expense.description ||
										`Log ${expense.startOdometer} → ${expense.endOdometer}`}
								</h2>
							</div>

							<span class="expense-amount-display" aria-label={`Miles: ${expense.miles ?? 0}`}>
								{(expense.miles ?? 0).toFixed(2)} mi
								{#if typeof expense.reimbursement === 'number' && expense.reimbursement > 0}
									<div class="reimbursement">({formatCurrency(expense.reimbursement)})</div>
								{/if}
							</span>
							<svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
								<path
									d="M9 18L15 12L9 6"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</div>

						<div class="card-stats">
							<div class="stat-badge-container">
								<span class={`category-badge ${getCategoryColor(expense.category)}`}>
									{(expense.miles ?? 0).toFixed(2)} mi
								</span>
								{#if isTripSource(expense)}
									<span class="source-badge">Trip Log</span>
								{/if}
								{#if expense.taxDeductible}
									<span class="category-badge tax-pill" title="Tax deductible">Tax Deductible</span>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No millage logs found matching your filters.</p>
		</div>
	{/if}
</div>

{#if selectedExpenses.size > 0}
	<div class="action-bar-container" data-has-selections="true">
		<div class="action-bar">
			<div class="action-bar-left">
				<div class="selection-indicator">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="20 6 9 17 4 12"></polyline>
					</svg>
					<span class="selected-count"
						>{selectedExpenses.size}
						{selectedExpenses.size === 1 ? 'expense' : 'expenses'} selected</span
					>
				</div>
			</div>

			<div class="action-bar-right">
				<button class="action-pill secondary" on:click={() => (selectedExpenses = new Set())}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
					<span class="action-text">Cancel</span>
				</button>

				<button class="action-pill export" on:click={exportSelected}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
						<polyline points="7 10 12 15 17 10"></polyline>
						<line x1="12" y1="15" x2="12" y2="3"></line>
					</svg>
					<span class="action-text">Export</span>
				</button>

				<button class="action-pill danger" on:click={deleteSelected}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
						></path>
					</svg>
					<span class="action-text">Delete</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<Modal bind:open={isManageCategoriesOpen} title="Manage Categories">
	<div class="categories-manager">
		<p class="text-sm text-gray-500 mb-4">
			Add or remove expense categories. These are saved to your settings.
		</p>

		<div class="cat-list">
			{#each categories as cat}
				<div class="cat-item">
					<span class={`cat-badge ${getCategoryColor(cat)}`}>{getCategoryLabel(cat)}</span>
					<button
						class="cat-delete"
						on:click={() => removeCategory(cat)}
						aria-label="Delete Category"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
							></line></svg
						>
					</button>
				</div>
			{:else}
				<div class="text-sm text-gray-400 italic text-center py-4">
					No categories. Add one below.
				</div>
			{/each}
		</div>

		<div class="add-cat-form">
			<input
				type="text"
				id="new-category-name"
				name="newCategoryName"
				class="input-field"
				on:keydown={(e) => e.key === 'Enter' && addCategory()}
			/>
			<button class="btn-secondary" on:click={addCategory}>Add</button>
		</div>

		<div class="modal-actions mt-6">
			<button class="btn-cancel w-full" on:click={() => (isManageCategoriesOpen = false)}
				>Done</button
			>
		</div>
	</div>
</Modal>

<style>
	* {
		box-sizing: border-box;
	}

	:global(body) {
		overflow-x: hidden;
	}

	.page-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 16px;
		padding-bottom: 80px;
		overflow-x: hidden;
	}

	/* Page Headers & Actions */
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
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3);
		transition: transform 0.1s;
		text-decoration: none;
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
	}

	@media (hover: hover) {
		.btn-secondary:hover {
			background: #f9fafb;
		}
		.cat-delete:hover {
			background: #ef4444;
			color: white;
		}
	}

	/* Stats Summary */
	.stats-summary {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
		margin-bottom: 24px;
	}
	.summary-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
	}
	.summary-label {
		font-size: 12px;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 4px;
	}
	.summary-value {
		font-size: 20px;
		font-weight: 800;
		color: #111827;
	}

	/* Filter Bar */
	.filters-bar {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 20px;
	}
	.sticky-bar {
		position: sticky;
		top: 0;
		z-index: 10;
		background: #f9fafb;
		padding: 10px 12px;
		margin: -12px -12px 10px -12px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
	}

	.search-box {
		position: relative;
		width: 100%;
	}
	.search-icon {
		position: absolute;
		left: 14px;
		top: 50%;
		transform: translateY(-50%);
		color: #9ca3af;
		pointer-events: none;
	}
	.search-box input {
		width: 100%;
		padding: 12px 16px 12px 42px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 15px;
		background: white;
		box-sizing: border-box;
	}
	.date-group {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.date-input {
		flex: 1;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 14px;
		background: white;
		min-width: 0;
	}
	.date-sep {
		color: #9ca3af;
		font-weight: bold;
	}
	.filter-group {
		display: flex;
		flex-direction: row;
		gap: 8px;
		width: 100%;
	}
	.filter-select {
		flex: 1;
		min-width: 0;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 14px;
		background: white;
		color: #374151;
	}
	.sort-btn {
		flex: 0 0 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: white;
		color: #6b7280;
		cursor: pointer;
	}

	/* Batch Header */
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
	.page-info {
		font-size: 13px;
	}

	/* CHECKBOX STYLES */
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

	@media (hover: hover) {
		.checkbox-container:hover input ~ .checkmark {
			border-color: #9ca3af;
		}
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

	/* Expense List & Cards (Styled like Trips) */
	.expense-list-cards {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 100%;
	}
	.card-wrapper {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		background: #f3f4f6;
		max-width: 100%;
	}

	.swipe-bg {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 20px;
		z-index: 0;
	}
	.swipe-action {
		font-weight: 700;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.swipe-action.edit {
		color: #2563eb;
	}
	.swipe-action.delete {
		color: #dc2626;
	}

	.expense-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 16px;
		position: relative;
		z-index: 1;
		cursor: pointer;
		transition: all 0.2s;
		max-width: 100%;
	}
	.expense-card:active {
		background-color: #f9fafb;
	}
	.expense-card.read-only {
		border-left: 4px solid #3b82f6;
		background: #fafafa;
	}
	.expense-card.selected {
		background-color: #fff7ed;
		border-color: #ff7f50;
	}

	.card-top {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 12px;
		padding-bottom: 12px;
		margin-bottom: 12px;
		border-bottom: 1px solid #f3f4f6;
		max-width: 100%;
	}

	.selection-box {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-right: 4px;
	}

	.expense-main-info {
		overflow: hidden;
		min-width: 0;
	}
	.expense-date-display {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 4px;
	}
	.expense-desc-title {
		font-size: 16px;
		font-weight: 700;
		color: #111827;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.expense-amount-display {
		font-size: 18px;
		font-weight: 800;
		color: #111827;
		white-space: nowrap;
		text-align: right;
		min-width: 72px;
	}

	.nav-icon {
		color: #9ca3af;
		flex-shrink: 0;
	}

	.card-stats {
		display: flex;
		align-items: center;
		max-width: 100%;
		overflow-x: auto;
	}
	.stat-badge-container {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.category-badge {
		font-size: 12px;
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 100px;
		text-transform: capitalize;
		border: 1px solid;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}

	.source-badge {
		font-size: 11px;
		font-weight: 700;
		color: #3b82f6;
		background: #eff6ff;
		padding: 4px 8px;
		border-radius: 6px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		white-space: nowrap;
	}

	/* Tax pill that visually matches category badges */
	.tax-pill {
		font-size: 12px;
		font-weight: 600;
		color: #166534;
		background: #ecfdf5;
		padding: 4px 10px;
		border-radius: 100px;
		border: 1px solid #bbf7d0;
		text-transform: capitalize;
		white-space: nowrap;
	}

	.empty-state {
		text-align: center;
		padding: 40px;
		color: #6b7280;
		font-size: 15px;
	}

	/* Hide footer when selections are active - using body class */
	:global(body.has-selections .mobile-footer),
	:global(body.has-selections footer),
	:global(body.has-selections nav[class*='mobile']),
	:global(body.has-selections .bottom-nav) {
		display: none !important;
	}

	/* ACTION BAR STYLES - REPLACES FOOTER ON MOBILE */
	.action-bar-container {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		justify-content: center;
		z-index: 1000;
		padding: 0;
		animation: slideUpFade 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
	}

	.action-bar {
		background: white;
		padding: 12px 16px;
		border-radius: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
		max-width: 100%;
		width: 100%;
		pointer-events: auto;
		border-top: 1px solid #e5e7eb;
	}

	.action-bar-left {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.selection-indicator {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #ff7f50;
		font-weight: 700;
		font-size: 13px;
		padding: 6px 12px;
		background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
		border-radius: 10px;
		border: 1px solid #fed7aa;
	}

	.selection-indicator svg {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
	}

	.selected-count {
		color: #c2410c;
		white-space: nowrap;
	}

	.action-bar-right {
		display: flex;
		gap: 6px;
		justify-content: center;
	}

	.action-pill {
		border: 2px solid transparent;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 13px;
		font-weight: 700;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		font-family: inherit;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.action-pill svg {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
	}

	/* Hide text on very small screens */
	.action-text {
		display: none;
	}

	.action-pill.secondary {
		background: white;
		color: #6b7280;
		border-color: #e5e7eb;
	}

	.action-pill.export {
		background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
		color: #c2410c;
		border-color: #fed7aa;
	}

	.action-pill.danger {
		background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
		color: #dc2626;
		border-color: #fca5a5;
	}

	.action-pill:active {
		transform: scale(0.95);
	}

	@media (hover: hover) {
		.action-pill.secondary:hover {
			background: #f9fafb;
			border-color: #d1d5db;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		}

		.action-pill.export:hover {
			background: linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%);
			border-color: #fdba74;
			box-shadow: 0 2px 4px rgba(251, 146, 60, 0.15);
		}

		.action-pill.danger:hover {
			background: linear-gradient(135deg, #fecaca 0%, #fca5a5 100%);
			border-color: #f87171;
			box-shadow: 0 2px 4px rgba(220, 38, 38, 0.15);
		}
	}

	@keyframes slideUpFade {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	/* Show text on slightly larger mobile screens */
	@media (min-width: 380px) {
		.action-text {
			display: inline;
		}

		.action-pill {
			padding: 10px 14px;
		}
	}

	@media (min-width: 640px) {
		.action-bar-container {
			bottom: 30px;
			padding: 0 16px;
		}

		.action-bar {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			padding: 14px 20px;
			max-width: 700px;
			width: auto; /* CHANGED: from inheriting 100% to auto */
			gap: 16px;
			border-radius: 16px;
			border: 1px solid #e5e7eb;
			box-shadow:
				0 0 0 1px rgba(0, 0, 0, 0.05),
				0 10px 25px -5px rgba(0, 0, 0, 0.1),
				0 8px 10px -6px rgba(0, 0, 0, 0.1);
		}

		.action-bar-left {
			justify-content: flex-start;
		}

		.selection-indicator {
			font-size: 14px;
			padding: 8px 14px;
		}

		.action-bar-right {
			gap: 8px;
		}

		.action-pill {
			flex: 0 0 auto;
			min-width: auto;
			padding: 10px 18px;
			font-size: 14px;
		}

		.action-text {
			display: inline;
		}
	}

	/* Desktop */
	@media (min-width: 1024px) {
		.action-bar {
			max-width: 800px;
			padding: 16px 24px;
		}

		.selection-indicator {
			font-size: 15px;
			padding: 8px 16px;
		}

		.action-pill {
			padding: 12px 24px;
			font-size: 15px;
		}
	}

	/* Categories Manager Modal Styles */
	.categories-manager {
		padding: 4px;
	}
	.cat-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 20px;
		max-height: 200px;
		overflow-y: auto;
	}
	.cat-item {
		display: flex;
		align-items: center;
		gap: 4px;
		background: #f3f4f6;
		padding: 4px 4px 4px 10px;
		border-radius: 20px;
		border: 1px solid #e5e7eb;
	}
	.cat-badge {
		font-size: 13px;
		font-weight: 500;
		text-transform: capitalize;
		padding: 0 4px;
		border: none;
		background: transparent;
	}
	.cat-delete {
		border: none;
		background: #e5e7eb;
		color: #6b7280;
		border-radius: 50%;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s;
	}

	.add-cat-form {
		display: flex;
		gap: 8px;
	}
	.add-cat-form .input-field {
		flex: 1;
		padding: 10px;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}
	.add-cat-form .btn-secondary {
		padding: 10px 16px;
	}
	.modal-actions .btn-cancel {
		background: white;
		border: 1px solid #e5e7eb;
		color: #374151;
		padding: 12px;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
	}

	@media (min-width: 640px) {
		.filters-bar {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
		.search-box {
			max-width: 300px;
		}
		.date-group {
			width: auto;
		}
		.filter-group {
			width: auto;
			flex-wrap: nowrap;
		}
		.filter-select {
			width: 140px;
			flex: none;
		}
		.stats-summary {
			grid-template-columns: repeat(4, 1fr);
		}
		.hidden-mobile {
			display: block;
		}
	}

	@media (max-width: 639px) {
		.hidden-mobile {
			display: none;
		}
	}
</style>
