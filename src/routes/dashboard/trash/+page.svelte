<script lang="ts">
	import { onMount } from 'svelte';
	import { trash } from '$lib/stores/trash';
	import { trips } from '$lib/stores/trips';
	import { expenses } from '$lib/stores/expenses';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { user } from '$lib/stores/auth';
	import { getDB } from '$lib/db/indexedDB';
	import type { TrashRecord } from '$lib/db/types';

	const resolve = (href: string) => `${base}${href}`;

	let trashedTrips: TrashRecord[] = []; // Using typed TrashRecord[] to handle the merged/flattened structure
	let loading = true;
	let restoring = new Set<string>();
	let deleting = new Set<string>();

	// Reactive current view type (expense|trip|undefined)
	let currentType: string | undefined;
	$: currentType = $page.url.searchParams.get('type') || undefined;
	async function loadTrash(type?: string) {
		try {
			const potentialIds = new Set<string>();
			if ($user?.name) potentialIds.add($user.name);
			if ($user?.token) potentialIds.add($user.token);
			const offlineId = localStorage.getItem('offline_user_id');
			if (offlineId) potentialIds.add(offlineId);

			const db = await getDB();
			const tx = db.transaction('trash', 'readonly');
			const index = tx.objectStore('trash').index('userId');

			let allItems: any[] = [];
			for (const id of potentialIds) {
				const items = await index.getAll(id);
				allItems = [...allItems, ...items];
			}

			// [!code fix] Robust Normalize/Flatten items: handle { data }, { trip }, and metadata wrappers
			let uniqueItems = Array.from(
				new Map(
					allItems.map((item) => {
						let flat: any = { ...item };

						// Handle wrappers from server/new API
						if (flat.data && typeof flat.data === 'object') {
							flat = { ...flat.data, ...flat };
							delete flat.data;
						}
						if (flat.trip && typeof flat.trip === 'object') {
							flat = { ...flat.trip, ...flat };
							delete flat.trip;
						}

						// Pull metadata fields up for convenience
						if (flat.metadata && typeof flat.metadata === 'object') {
							flat.deletedAt = flat.metadata.deletedAt || flat.deletedAt;
							flat.expiresAt = flat.metadata.expiresAt || flat.expiresAt;
							flat.originalKey = flat.metadata.originalKey || flat.originalKey;
							delete flat.metadata;
						}

						// Ensure a recordType exists for filtering
						if (!flat.recordType && !flat.type) {
							if (flat.originalKey?.startsWith('expense:')) flat.recordType = 'expense';
							else flat.recordType = 'trip';
						} else if (flat.type && !flat.recordType) {
							flat.recordType = flat.type;
						}

						return [flat.id, flat];
					})
				).values()
			);

			// Optionally filter by type (expense or trip)
			if (type === 'expense') {
				uniqueItems = uniqueItems.filter((item) => {
					const isExpense =
						(item['type'] as string | undefined) === 'expense' ||
						(item['recordType'] as string | undefined) === 'expense' ||
						(item['originalKey'] as string | undefined)?.startsWith('expense:');
					return !!isExpense;
				});
			} else if (type === 'trip') {
				uniqueItems = uniqueItems.filter((item) => {
					const isExpense =
						(item['type'] as string | undefined) === 'expense' ||
						(item['recordType'] as string | undefined) === 'expense' ||
						(item['originalKey'] as string | undefined)?.startsWith('expense:');
					return !isExpense;
				});
			}

			// Enrich items with local 'trips' or 'expenses' data when available so UI can render full details
			for (const item of uniqueItems) {
				// Consider an item metadata-only until we find data
				(item as any)._isMetadataOnly = true;

				// Detect if the flat item already has meaningful fields
				const hasDetailFields = !!(
					item.startAddress ||
					item.stops ||
					item.totalMiles ||
					item.amount ||
					item.category ||
					item.date
				);
				if (hasDetailFields) {
					(item as any)._isMetadataOnly = false;
					continue;
				}

				// Try to fetch local trip/expense record from the DB to enrich metadata-only items
				try {
					const qdb = await getDB();
					const txTrips = qdb.transaction('trips', 'readonly');
					let localTrip = await txTrips.objectStore('trips').get(item.id);
					if (localTrip) {
						Object.assign(item, localTrip);
						(item as any)._isMetadataOnly = false;
						continue;
					}

					// Fallback: parse originalKey (e.g. 'trip:user:ID' or 'expense:user:ID') and try lookup by that id
					let parsedId: string | undefined;
					if (typeof item.originalKey === 'string') {
						parsedId = String(item.originalKey).split(':').pop() || undefined;
						if (parsedId) {
							localTrip = await txTrips.objectStore('trips').get(parsedId);
							if (localTrip) {
								Object.assign(item, localTrip);
								(item as any)._isMetadataOnly = false;
								continue;
							}
						}
					}

					// If not a trip, try expenses store
					const txExpenses = qdb.transaction('expenses', 'readonly');
					let localExpense = await txExpenses.objectStore('expenses').get(item.id);
					if (localExpense) {
						Object.assign(item, localExpense);
						(item as any)._isMetadataOnly = false;
						continue;
					}

					// Fallback for expenses using originalKey parsed id
					if (!localExpense && parsedId) {
						localExpense = await txExpenses.objectStore('expenses').get(parsedId);
						if (localExpense) {
							Object.assign(item, localExpense);
							(item as any)._isMetadataOnly = false;
							continue;
						}
					}

					// Final fallback: fetch from server API if local DB misses the full record
					if (parsedId) {
						try {
							// Prefer trip endpoint first (if recordType hints trip), else try expense
							if (
								(item.recordType as string | undefined) === 'expense' ||
								(item.type as string | undefined) === 'expense'
							) {
								const res = await fetch(`/api/expenses/${encodeURIComponent(parsedId)}`);
								if (res.ok) {
									const data = await res.json();
									Object.assign(item, data);
									(item as any)._isMetadataOnly = false;
									continue;
								}
							}

							const res = await fetch(`/api/trips/${encodeURIComponent(parsedId)}`);
							if (res.ok) {
								const data = await res.json();
								Object.assign(item, data);
								(item as any)._isMetadataOnly = false;
								continue;
							}
						} catch (err) {
							// ignore server fetch errors, we already warned below
						}
					}
				} catch (err) {
					console.warn('Failed to enrich trash item:', err);
				}
			}

			uniqueItems.sort(
				(a, b) => new Date(b.deletedAt || 0).getTime() - new Date(a.deletedAt || 0).getTime()
			);
			trashedTrips = uniqueItems;
		} catch (err) {
			console.error('Error loading trash:', err);
		} finally {
			loading = false;
		}
	}

	async function restoreTrip(id: string) {
		if (restoring.has(id)) return;
		const item = trashedTrips.find((t) => t.id === id);
		if (!item) {
			alert('Item not found locally');
			return;
		}

		restoring.add(id);
		restoring = restoring;

		try {
			// Pass userId to ensure security/correctness
			await trash.restore(id, item.userId);

			// Reload the correct store based on type
			const isExpense =
				(item['type'] as string | undefined) === 'expense' ||
				(item['recordType'] as string | undefined) === 'expense' ||
				(item['originalKey'] as string | undefined)?.startsWith('expense:');

			if (isExpense) {
				await expenses.load(item.userId);
			} else {
				await trips.load(item.userId);
			}

			await loadTrash();
		} catch (err) {
			alert('Failed to restore item.');
			console.error(err);
		} finally {
			restoring.delete(id);
			restoring = restoring;
		}
	}

	async function restoreAll() {
		if (trashedTrips.length === 0) return;
		if (!confirm(`Are you sure you want to restore all ${trashedTrips.length} items?`)) return;

		loading = true;
		try {
			// Process sequentially to avoid DB contention
			for (const trip of trashedTrips) {
				await trash.restore(trip.id, trip.userId);
			}

			const userId = $user?.name || $user?.token;
			if (userId) {
				await trips.load(userId);
				await expenses.load(userId);
			}
			await loadTrash();
		} catch (err) {
			console.error('Failed to restore all:', err);
			alert('Failed to restore some items.');
		} finally {
			loading = false;
		}
	}

	async function permanentDelete(id: string) {
		if (!confirm('Permanently delete this item? Cannot be undone.')) return;
		const item = trashedTrips.find((t) => t.id === id);
		if (!item) return;

		if (deleting.has(id)) return;
		deleting.add(id);
		deleting = deleting;

		try {
			await trash.permanentDelete(id);
			await loadTrash();
		} catch (err) {
			alert('Failed to delete item.');
		} finally {
			deleting.delete(id);
			deleting = deleting;
		}
	}

	async function emptyTrash() {
		if (!confirm('Permanently delete ALL items? Cannot be undone.')) return;
		try {
			const uniqueUserIds = new Set(trashedTrips.map((t) => t.userId));
			for (const uid of uniqueUserIds) {
				await trash.emptyTrash(uid);
			}
			await loadTrash();
		} catch (err) {
			alert('Failed to empty trash.');
		}
	}

	function formatDate(dateString: string | undefined): string {
		if (!dateString) return 'Unknown';
		const date = new Date(dateString);
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(date);
	}

	function getDaysUntilExpiration(expiresAt: string | undefined): number {
		if (!expiresAt) return 0;
		const now = new Date();
		const expires = new Date(expiresAt);
		const diff = expires.getTime() - now.getTime();
		return Math.ceil(diff / (1000 * 60 * 60 * 24));
	}

	function getStopCount(t: any): number {
		if (!t) return 0;
		if (Array.isArray(t.stops)) return t.stops.length;
		if (t.stops && typeof t.stops === 'object') return Object.keys(t.stops).length;
		return 0;
	}

	function firstPart(value: unknown): string | null {
		if (typeof value !== 'string') return null;
		const parts = (value as string).split(',');
		return parts[0] ?? null;
	}

	function getTripTitle(t: any): string {
		// Safely extract an address/title from several possible shapes of 'stops' or fields
		const firstStopAddress = Array.isArray(t.stops)
			? (t.stops[0]?.address as string | undefined)
			: t.stops && typeof t.stops === 'object'
				? (Object.values(t.stops as Record<string, any>)[0] as any)?.address
				: undefined;

		const v =
			firstPart(t.startAddress) ||
			firstPart(firstStopAddress) ||
			firstPart(t.endAddress) ||
			firstPart(t.notes);
		if (v) return v;

		// Fallback: if we only have an originalKey like 'trip:USER:ID', show a concise label
		if (typeof t.originalKey === 'string') {
			const parts = t.originalKey.split(':');
			const id = parts.pop() || t.originalKey;
			return `Trip (${String(id).slice(0, 8)})`;
		}

		return 'Unknown Trip';
	}

	function getLastStopShort(t: any): string | null {
		if (Array.isArray(t.stops) && t.stops.length)
			return (t.stops[t.stops.length - 1]?.address || '').split(',')[0];
		if (t.stops && typeof t.stops === 'object') {
			const vals = Object.values(t.stops) as any[];
			if (vals.length) return (vals[vals.length - 1]?.address || '').split(',')[0];
		}
		return null;
	}

	function getFullTripTitle(t: any, lastShort?: string | null): string {
		const start = getTripTitle(t);
		const last = lastShort ?? getLastStopShort(t);
		if (last && start !== last) return `${start} → ${last}`;
		return start;
	}

	// Run initial load on mount (after functions are defined)
	onMount(async () => {
		const type = $page.url.searchParams.get('type') || undefined;
		await loadTrash(type);
		const userId = $user?.name || $user?.token;
		if (userId) {
			await trash.syncFromCloud(userId, type);
			await loadTrash(type);
		}
	});
</script>

<svelte:head>
	<title>Trash - Go Route Yourself</title>
</svelte:head>

<div class="trash-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Trash</h1>
			<p class="page-subtitle">Items deleted > 30 days ago are removed automatically</p>
		</div>

		<div class="header-actions">
			{#if trashedTrips.length > 0}
				<button class="btn-success" on:click={restoreAll}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path
							d="M4 4V9H4.58579M4.58579 9H9M4.58579 9L9 4.41421M16 16V11H15.4142M15.4142 11H11M15.4142 11L11 15.5858"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Restore All
				</button>

				<button class="btn-danger" on:click={emptyTrash}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<path
							d="M2 4H14M12 4V13C12 13.5304 11.7893 14.0391 11.4142 14.4142C11.0391 14.7893 10.5304 15 10 15H6C5.46957 15 4.96086 14.7893 4.58579 14.4142C4.21071 14.0391 4 13.5304 4 13V4M5 4V3C5 2.46957 5.21071 1.96086 5.58579 1.58579C5.96086 1.21071 6.46957 1 7 1H9C9.53043 1 10.0391 1.21071 10.4142 1.58579C10.7893 1.96086 11 2.46957 11 3V4"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					Empty Trash
				</button>
			{/if}

			<button
				class="btn-secondary"
				on:click={() =>
					goto(resolve(currentType === 'expense' ? '/dashboard/expenses' : '/dashboard/trips'))}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
					<path
						d="M10 19L3 12M3 12L10 5M3 12H21"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{#if currentType === 'expense'}
					Back to Expenses
				{:else}
					Back to Trips
				{/if}
			</button>
		</div>
	</div>

	{#if loading}
		<div class="loading">Loading trash...</div>
	{:else if trashedTrips.length === 0}
		<div class="empty-state">
			<svg width="64" height="64" viewBox="0 0 64 64" fill="none">
				<path
					d="M16 16H48M44 16V52C44 54.2091 42.2091 56 40 56H24C21.7909 56 20 54.2091 20 52V16M26 16V12C26 9.79086 27.7909 8 30 8H34C36.2091 8 38 9.79086 38 12V16"
					stroke="#9CA3AF"
					stroke-width="4"
					stroke-linecap="round"
				/>
			</svg>
			<h2>Trash is empty</h2>
			<p>Deleted items will appear here</p>
		</div>
	{:else}
		<div class="trash-list">
			{#each trashedTrips as trip (trip.id)}
				{@const t = trip as TrashRecord}
				{@const expiresAt =
					(t['expiresAt'] as string | undefined) ||
					((t['metadata'] as any)?.expiresAt as string | undefined)}
				{@const deletedAt =
					(t['deletedAt'] as string | undefined) ||
					((t['metadata'] as any)?.deletedAt as string | undefined)}
				{@const daysLeft = getDaysUntilExpiration(expiresAt)}

				{@const isExpense =
					(t['type'] as string | undefined) === 'expense' ||
					(t['recordType'] as string | undefined) === 'expense' ||
					(t['originalKey'] as string | undefined)?.startsWith('expense:')}
				{@const stops = getStopCount(trip)}
				{@const lastStopShort = getLastStopShort(trip)}
				<div class="trash-item">
					<div class="trip-info">
						<div class="trip-header">
							<h3 class="trip-title">
								{#if isExpense}
									<span class="badge-expense">Expense</span>
									<span class="expense-category">{trip.category || 'Uncategorized'}</span>
								{:else}
									{getFullTripTitle(trip, lastStopShort)}
								{/if}
							</h3>
							<div class="trip-meta">
								<span class="deleted-date">Deleted {formatDate(deletedAt)}</span>
								<span class="expiration" class:warning={daysLeft <= 7}>
									{daysLeft} days left
								</span>
							</div>
						</div>

						{#if !trip['_isMetadataOnly']}
							<div class="trip-details">
								{#if isExpense}
									<span class="detail amount">${Number(trip.amount || 0).toFixed(2)}</span>
									{#if trip.description}<span class="detail">{trip.description}</span>{/if}
									{#if trip.date || trip.createdAt}
										<span class="detail">{formatDate(trip.date || trip.createdAt)}</span>
									{/if}
								{:else}
									{#if trip.date || trip.createdAt}
										<span class="detail">{formatDate(trip.date || trip.createdAt)}</span>
									{/if}
									{#if typeof stops === 'number'}
										<span class="detail">{stops} {stops === 1 ? 'stop' : 'stops'}</span>
									{/if}
									{#if trip.totalMiles}
										<span class="detail">{Number(trip.totalMiles).toFixed(1)} mi</span>
									{/if}
								{/if}
							</div>
						{/if}
					</div>
					<div class="trip-actions">
						<button
							class="btn-restore-item"
							on:click={() => restoreTrip(trip.id)}
							disabled={restoring.has(trip.id)}
						>
							{restoring.has(trip.id) ? 'Restoring...' : 'Restore'}
						</button>
						<button
							class="btn-delete-item"
							on:click={() => permanentDelete(trip.id)}
							disabled={deleting.has(trip.id)}
						>
							Delete
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.trash-page {
		padding: 16px;
		max-width: 1200px;
		margin: 0 auto;
	}
	.page-header {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 24px;
	}
	.page-title {
		font-size: 24px;
		font-weight: 800;
		color: #111827;
		margin: 0 0 4px 0;
	}
	.page-subtitle {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
		line-height: 1.4;
	}
	.header-actions {
		display: flex;
		gap: 12px;
		width: 100%;
	}

	.btn-danger,
	.btn-success,
	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 10px 16px;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
		cursor: pointer;
		transition: all 0.2s;
		flex: 1;
		text-decoration: none;
	}
	.btn-danger {
		background: #dc2626;
		color: white;
		box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
	}
	.btn-danger:hover {
		background: #b91c1c;
	}
	.btn-success {
		background: linear-gradient(135deg, #10b981 0%, #059669 100%);
		color: white;
		box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
	}
	.btn-success:hover {
		filter: brightness(1.1);
	}
	.btn-secondary {
		background: white;
		color: #374151;
		border: 1px solid #e5e7eb;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
	}
	.btn-secondary:hover {
		background: #f9fafb;
		border-color: #d1d5db;
	}

	.trash-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.trash-item {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		transition: all 0.2s;
	}
	.trip-info {
		flex: 1;
	}
	.trip-title {
		font-size: 16px;
		font-weight: 700;
		color: #111827;
		margin: 0 0 8px 0;
		line-height: 1.3;
	}
	.trip-meta {
		display: flex;
		gap: 12px;
		font-size: 12px;
		flex-wrap: wrap;
	}
	.deleted-date {
		color: #6b7280;
	}
	.expiration {
		color: #10b981;
		font-weight: 600;
	}
	.expiration.warning {
		color: #f59e0b;
	}

	.trip-details {
		display: flex;
		gap: 12px;
		margin-top: 8px;
		font-size: 13px;
		color: #6b7280;
		flex-wrap: wrap;
	}
	.detail {
		display: flex;
		align-items: center;
		background: #f3f4f6;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.trip-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		width: 100%;
	}
	.btn-restore-item,
	.btn-delete-item {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 10px 16px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}
	.btn-restore-item {
		background: #dcfce7;
		color: #166534;
	}
	.btn-delete-item {
		background: #fef2f2;
		color: #dc2626;
	}

	.empty-state {
		text-align: center;
		padding: 40px 20px;
	}
	.empty-state svg {
		margin-bottom: 16px;
	}

	.badge-expense {
		background-color: #dbeafe;
		color: #1e40af;
		font-size: 0.8em;
		padding: 2px 6px;
		border-radius: 4px;
		margin-right: 6px;
		vertical-align: middle;
		font-weight: 600;
	}
	.expense-category {
		text-transform: capitalize;
	}
	.amount {
		color: #111827;
		font-weight: 700;
	}

	@media (min-width: 640px) {
		.page-header {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
		}
		.header-actions {
			width: auto;
		}
		.trash-item {
			flex-direction: row;
			align-items: center;
		}
		.trip-actions {
			width: auto;
			display: flex;
		}
		.btn-danger,
		.btn-success,
		.btn-secondary {
			width: auto;
			flex: none;
		}
	}
</style>
