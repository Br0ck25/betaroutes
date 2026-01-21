<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { trash } from '$lib/stores/trash';
	import { trips } from '$lib/stores/trips';
	import { expenses } from '$lib/stores/expenses';
	import { mileage } from '$lib/stores/mileage';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { user } from '$lib/stores/auth';
	import { getDB } from '$lib/db/indexedDB';
	import type { TrashRecord } from '$lib/db/types';
	import { get } from 'svelte/store';
	import { userSettings } from '$lib/stores/userSettings';
	import { getVehicleDisplayName } from '$lib/utils/vehicle';

	const resolve = (href: string) => `${base}${href}`;

	// Known user-friendly error messages that are safe to display
	const KNOWN_RESTORE_ERROR_MESSAGES = [
		'Item not found in trash',
		'Unauthorized',
		'The parent Trip is currently in the Trash. Please restore the Trip first.',
		'This mileage log belongs to a trip that has been permanently deleted. It cannot be restored.'
	];

	let trashedTrips: TrashRecord[] = [];
	let loading = true;
	let restoring = new Set<string>();
	let deleting = new Set<string>();
	let currentTypeParam: string | null = null;
	let _pageUnsub: (() => void) | null = null;

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const typeParam = params.get('type');
		const type =
			typeParam === 'expenses' ? 'expense' : typeParam === 'mileage' ? 'mileage' : undefined;

		// 1. Load Local
		loadTrash(type).catch(console.error);

		// 2. [!code fix] Force Cloud Sync on Mount
		const userState = get(user);
		const userId = userState?.name || userState?.token;
		if (userId) {
			trash.syncFromCloud(userId, typeParam || undefined).then(() => loadTrash(type));
		}

		// Subscribe to page changes
		_pageUnsub = page.subscribe(async ($p) => {
			const param = $p.url.searchParams.get('type');
			if (param !== currentTypeParam) {
				currentTypeParam = param;
				const type = param === 'expenses' ? 'expense' : param === 'mileage' ? 'mileage' : undefined;
				loading = true;
				try {
					await loadTrash(type);
					const userState = get(user);
					const userId = userState?.name || userState?.token;
					if (userId) {
						await trash.syncFromCloud(userId, param || undefined);
						await loadTrash(type);
					}
				} catch (err) {
					console.error('Failed to refresh trash for type change', err);
				} finally {
					loading = false;
				}
			}
		});
	});

	onDestroy(() => {
		if (typeof _pageUnsub === 'function') _pageUnsub();
	});

	async function loadTrash(type?: string) {
		loading = true;
		try {
			const potentialIds = new Set<string>();
			if ($user?.name) potentialIds.add($user.name);
			if ($user?.token) potentialIds.add($user.token);
			const offlineId =
				typeof localStorage !== 'undefined' ? localStorage.getItem('offline_user_id') : null;
			if (offlineId) potentialIds.add(offlineId);

			const db = await getDB();
			const tx = db.transaction('trash', 'readonly');
			const index = tx.objectStore('trash').index('userId');

			let allItems: any[] = [];
			for (const id of potentialIds) {
				const items = await index.getAll(id);
				allItems = [...allItems, ...items];
			}

			// Normalize/Flatten
			const uniqueItems = Array.from(
				new Map(
					allItems.map((item) => {
						let flat = { ...item };
						if (flat.data && typeof flat.data === 'object') {
							flat = { ...flat.data, ...flat };
							delete flat.data;
						}
						return [flat.id, flat];
					})
				).values()
			);

			const effectiveType =
				type ??
				(currentTypeParam === 'expenses'
					? 'expense'
					: currentTypeParam === 'mileage'
						? 'mileage'
						: undefined);

			const filtered = uniqueItems.filter((it: any) => {
				const recordTypes = Array.isArray(it.recordTypes)
					? it.recordTypes
					: it.recordType
						? [it.recordType]
						: [];

				if (recordTypes.length > 0) {
					// If viewing 'all', show everything; otherwise include items whose recordTypes include the view
					if (!type && !currentTypeParam) return true;
					return recordTypes.includes(effectiveType as any);
				}

				// Fallback: infer from key or shape
				const inferredFromKey =
					it.recordType ||
					it.type ||
					(it.originalKey &&
						(it.originalKey.startsWith('expense:')
							? 'expense'
							: it.originalKey.startsWith('mileage:')
								? 'mileage'
								: 'trip')) ||
					'trip';
				const hasMileageShape = typeof it.miles === 'number' || Boolean(it.vehicle);
				const inferred = hasMileageShape ? 'mileage' : inferredFromKey;
				return inferred === effectiveType;
			});
			filtered.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
			trashedTrips = filtered;
		} catch (err) {
			console.error('Error loading trash:', err);
		} finally {
			loading = false;
		}
	}

	async function restoreTrip(id: string) {
		if (restoring.has(id)) return;
		const item = trashedTrips.find((t) => t.id === id);
		if (!item) return;

		restoring.add(id);
		restoring = restoring;

		try {
			// Prefer current view when restoring ambiguous/merged tombstones
			const displayType =
				currentTypeParam === 'expenses'
					? 'expense'
					: currentTypeParam === 'mileage'
						? 'mileage'
						: Array.isArray((item as any).recordTypes) && (item as any).recordTypes.length
							? (item as any).recordTypes[0]
							: (item as any).recordType ||
								(item as any).type ||
								(typeof (item as any).miles === 'number' ? 'mileage' : 'trip');

			// Actually restore the item from trash
			await trash.restore(id, item.userId, displayType);

			// Optimistic update - add item back to appropriate store immediately
			const itemData = (item as any).data || (item as any).backups?.[displayType] || item;
			if (displayType === 'expense' && itemData) {
				expenses.updateLocal(itemData);
			} else if (displayType === 'mileage' && itemData) {
				mileage.updateLocal(itemData);
			} else if (itemData) {
				trips.updateLocal(itemData);
			}

			// Reload trash to remove restored item from view
			await loadTrash();
		} catch (err) {
			// Only show known user-friendly error messages, fallback to generic for unknown errors
			const errorMessage = err instanceof Error ? err.message : '';
			const message = KNOWN_RESTORE_ERROR_MESSAGES.includes(errorMessage)
				? errorMessage
				: 'Failed to restore item.';
			alert(message);
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
			for (const trip of trashedTrips) {
				const displayType =
					currentTypeParam === 'expenses'
						? 'expense'
						: currentTypeParam === 'mileage'
							? 'mileage'
							: Array.isArray((trip as any).recordTypes) && (trip as any).recordTypes.length
								? (trip as any).recordTypes[0]
								: (trip as any).recordType ||
									(trip as any).type ||
									(typeof (trip as any).miles === 'number' ? 'mileage' : 'trip');
				await trash.restore(trip.id, trip.userId, displayType);
			}
			const userId = $user?.name || $user?.token;
			if (userId) {
				await trips.load(userId);
				await expenses.load(userId);
				await mileage.load(userId);
			}
			await loadTrash();
		} catch (err) {
			// Only show known user-friendly error messages, fallback to generic for unknown errors
			const errorMessage = err instanceof Error ? err.message : '';
			const message = KNOWN_RESTORE_ERROR_MESSAGES.includes(errorMessage)
				? errorMessage
				: 'Failed to restore some items.';
			alert(message);
		} finally {
			loading = false;
		}
	}

	async function permanentDelete(id: string) {
		if (!confirm('Permanently delete this item? Cannot be undone.')) return;

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
				<button class="btn-success" on:click={restoreAll}> Restore All </button>
				<button class="btn-danger" on:click={emptyTrash}> Empty Trash </button>
			{/if}

			{#if currentTypeParam === 'expenses'}
				<button class="btn-secondary" on:click={() => goto(resolve('/dashboard/expenses'))}>
					Back to Expenses
				</button>
			{:else if currentTypeParam === 'mileage'}
				<button class="btn-secondary" on:click={() => goto(resolve('/dashboard/mileage'))}>
					Back to Mileage
				</button>
			{:else}
				<button class="btn-secondary" on:click={() => goto(resolve('/dashboard/trips'))}>
					Back to Trips
				</button>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="loading">Loading trash...</div>
	{:else if trashedTrips.length === 0}
		<div class="empty-state">
			<h2>Trash is empty</h2>
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

				{@const displayType =
					currentTypeParam === 'expenses'
						? 'expense'
						: currentTypeParam === 'mileage'
							? 'mileage'
							: Array.isArray(t['recordTypes']) && t['recordTypes'].length
								? t['recordTypes'][0]
								: t['recordType'] ||
									t['type'] ||
									(typeof t['miles'] === 'number' ? 'mileage' : 'trip')}

				{@const isExpense = displayType === 'expense'}
				{@const isMileage = displayType === 'mileage'}
				{@const rawVehicleName = getVehicleDisplayName(
					trip['vehicle'] as string | undefined,
					$userSettings?.vehicles
				)}
				{@const vehicleDisplay =
					rawVehicleName && rawVehicleName !== '-' && rawVehicleName !== 'Unknown vehicle'
						? rawVehicleName
						: null}
				{@const mileageLogDate = trip.date || trip.createdAt}

				<div class="trash-item">
					<div class="trip-info">
						<div class="trip-header">
							<h3 class="trip-title">
								{#if isExpense}
									<span class="badge-expense">Expense</span>
									<span class="expense-category">{trip.category || 'Uncategorized'}</span>
								{:else if isMileage}
									<span class="badge-mileage">Mileage</span>
									{vehicleDisplay
										? vehicleDisplay
										: mileageLogDate
											? formatDate(mileageLogDate)
											: 'Mileage Log'}
								{:else}
									<span class="badge-trip">Trip</span>
									{typeof trip.startAddress === 'string'
										? trip.startAddress.split(',')[0]
										: 'Unknown Trip'}
								{/if}
							</h3>
							<div class="trip-meta">
								<span class="deleted-date">Deleted {formatDate(deletedAt)}</span>
								<span class="expiration" class:warning={daysLeft <= 7}>
									{daysLeft} days left
								</span>
							</div>
						</div>

						<div class="trip-details">
							{#if isExpense}
								<span class="detail amount">${Number(trip.amount || 0).toFixed(2)}</span>
								{#if trip.description}<span class="detail">{trip.description}</span>{/if}
								<span class="detail"
									>{new Date(trip.date || trip.createdAt || '').toLocaleDateString()}</span
								>
							{:else if isMileage}
								<span class="detail"
									>{new Date(trip.date || trip.createdAt || '').toLocaleDateString()}</span
								>
								<span class="detail amount">{Number(trip['miles'] || 0).toFixed(2)} mi</span>
								{#if trip.notes}<span class="detail">{trip.notes}</span>{/if}
							{:else}
								<span class="detail"
									>{new Date(trip.date || trip.createdAt || '').toLocaleDateString()}</span
								>
								<span class="detail">{trip.stops?.length || 0} stops</span>
								{#if trip.totalMiles}<span class="detail"
										>{Number(trip.totalMiles).toFixed(1)} mi</span
									>{/if}
							{/if}
						</div>
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
	/* Add this new style for mileage badges */
	.badge-mileage {
		background-color: #d1fae5;
		color: #065f46;
		font-size: 0.8em;
		padding: 2px 6px;
		border-radius: 4px;
		margin-right: 6px;
		vertical-align: middle;
		font-weight: 600;
	}
	.badge-trip {
		background-color: #dbeafe;
		color: #1e40af;
		font-size: 0.8em;
		padding: 2px 6px;
		border-radius: 4px;
		margin-right: 6px;
		vertical-align: middle;
		font-weight: 600;
	}
	/* Keep existing styles */
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
