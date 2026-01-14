<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { userSettings } from '$lib/stores/userSettings';
	import { saveSettings } from '../settings/lib/save-settings';
	import { toasts } from '$lib/stores/toast';
	import { formatCurrency } from '$lib/utils/dashboardLogic';

	// Focus helper for the native "New" button
	function goToAdd() {
		const el = document.getElementById('millage-start');
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			(el as HTMLInputElement).focus();
		}
	}

	let items = $state([] as any[]);
	let loading = $state(false);
	let startOdo = $state<number | ''>('');
	let endOdo = $state<number | ''>('');
	let date = $state<string>(String(new Date().toISOString().split('T')[0]));
	let notes = $state('');
	let totalMiles = $state(0);
	let totalReimbursement = $state(0);

	$effect(() => {
		totalMiles = items.reduce((s, it) => s + (Number(it.miles) || 0), 0);
		totalReimbursement = items.reduce(
			(s, it) => s + Number(it.miles || 0) * Number($userSettings.millageRate || 0),
			0
		);
	});

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/millage');
			if (!res.ok) throw new Error('Failed to load');
			items = await res.json();
		} catch (e) {
			console.error(e);
			toasts.error('Could not load millage logs');
		} finally {
			loading = false;
		}
	}

	async function add() {
		if (startOdo === '' || endOdo === '')
			return toasts.error('Please enter both odometer readings');
		const s = Number(startOdo);
		const e = Number(endOdo);
		if (e < s) return toasts.error('End odometer must be >= start');

		const miles = e - s;
		const reimbursement = miles * Number($userSettings.millageRate || 0);

		try {
			const res = await fetch('/api/millage', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date,
					startOdometer: s,
					endOdometer: e,
					miles,
					reimbursement,
					notes
				})
			});
			if (!res.ok) throw new Error('Failed to save');
			const saved = await res.json();
			items = [saved, ...items];
			startOdo = '';
			endOdo = '';
			date = String(new Date().toISOString().split('T')[0]);
			notes = '';
			toasts.success('Saved');
		} catch (err) {
			console.error(err);
			toasts.error('Could not save');
		}
	}

	async function remove(id: string) {
		if (!confirm('Move this log to Trash?')) return;
		try {
			const res = await fetch(`/api/millage/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed');
			items = items.filter((i) => i.id !== id);
			toasts.success('Moved to Trash');
		} catch (err) {
			console.error(err);
			toasts.error('Delete failed');
		}
	}

	async function changeRate(value: string) {
		const v = parseFloat(value);
		if (isNaN(v)) return toasts.error('Invalid rate');
		const res = await saveSettings({ millageRate: v });
		if (!res.ok) return toasts.error('Could not save rate');
		toasts.success('Rate updated');
	}

	onMount(load);

	let editRate = $state(false);
	let rateInput = $state(String($userSettings.millageRate ?? 0));

	function startEditRate() {
		rateInput = String($userSettings.millageRate ?? 0);
		editRate = true;
	}

	function saveRate() {
		const v = String(rateInput);
		changeRate(v);
		editRate = false;
	}

	function cancelEditRate() {
		editRate = false;
	}
</script>

<svelte:head>
	<title>Millage - Dashboard</title>
</svelte:head>

<div class="page-container">
	<div class="page-header">
		<div class="header-text">
			<h1 class="page-title">Millage Tracker</h1>
			<p class="page-subtitle">Log start/end odometer readings and track reimbursement</p>
			<div class="header-meta">
				<span class="meta-label">Rate:</span>
				<span class="meta-value">{formatCurrency($userSettings.millageRate ?? 0)}/mi</span>
				<button class="btn-link" onclick={startEditRate} aria-label="Edit rate">Edit</button>
			</div>
		</div>
		<div class="header-actions">
			<button
				class="btn-secondary"
				aria-label="View Trash"
				onclick={() => goto('/dashboard/trash')}
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
				onclick={() => goto('/dashboard/settings')}
				aria-label="Settings"
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
					<path
						d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
					/>
					<circle cx="12" cy="12" r="3" />
				</svg>
			</button>
			{#if editRate}
				<div style="display:flex; gap:8px; align-items:center;">
					<input class="rate-input" type="number" step="0.01" bind:value={rateInput} />
					<button class="btn-primary" onclick={saveRate}>Save</button>
					<button class="btn-secondary" onclick={cancelEditRate}>Cancel</button>
				</div>
			{/if}
			<button class="btn-primary" onclick={goToAdd} aria-label="New Log">
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"
					><path
						d="M10 4V16M4 10H16"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
				New Log
			</button>
		</div>
	</div>

	<div class="stats-summary">
		<div class="summary-card">
			<div class="summary-label">Total Miles</div>
			<div class="summary-value">{Number(totalMiles || 0).toFixed(2)}</div>
		</div>

		<div class="summary-card">
			<div class="summary-label">Total Reimbursement</div>
			<div class="summary-value">{formatCurrency(totalReimbursement || 0)}</div>
		</div>
	</div>

	<div class="form-card">
		<div class="card-header">
			<h2 class="card-title">Add Millage Log</h2>
		</div>

		<div class="form-grid">
			<div class="form-row">
				<div class="form-group">
					<label>Start Odometer<input type="number" bind:value={startOdo} /></label>
				</div>
				<div class="form-group">
					<label>End Odometer<input type="number" bind:value={endOdo} /></label>
				</div>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label>Date<input type="date" bind:value={date} /></label>
				</div>
				<div class="form-group">
					<label>Notes<input type="text" bind:value={notes} /></label>
				</div>
			</div>

			<div class="form-row">
				<div></div>
				<div style="display:flex; justify-content:flex-end; gap:12px">
					<button class="btn-secondary" onclick={() => load()}>Refresh</button>
					<button class="btn-primary" onclick={add}>Add</button>
				</div>
			</div>
		</div>
	</div>

	<div class="list-card">
		{#if loading}
			<div class="empty-state">Loading…</div>
		{:else if items.length === 0}
			<div class="empty-state">No logs yet</div>
		{:else}
			<ul class="list">
				{#each items as it}
					<li class="list-item">
						<div class="list-item-main">
							<div class="list-title">
								{it.date?.split('T')[0]} — {Number(it.miles || 0).toFixed(2)} mi
							</div>
							<div class="list-sub">
								{formatCurrency((it.miles || 0) * Number($userSettings.millageRate || 0))}
							</div>
						</div>
						<div class="list-actions">
							<button class="btn-danger" onclick={() => remove(it.id)}>Delete</button>
						</div>
						{#if it.notes}
							<div class="list-notes">{it.notes}</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	label {
		font-size: 16px;
		font-weight: 600;
		color: #374151;
	}

	input {
		width: 100%;
		padding: 12px;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		font-size: 16px;
		background: white;
		box-sizing: border-box;
	}

	.form-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 16px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.card-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	/* Stats Summary (match Expenses) */
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

	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.list-item {
		background: white;
		border: 1px solid #e5e7eb;
		padding: 16px;
		border-radius: 12px;
	}
	.list-item-main {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
	}
	.list-title {
		font-weight: 700;
	}
	.list-sub {
		color: #6b7280;
	}
	.list-notes {
		margin-top: 8px;
		color: #6b7280;
	}
	.list-actions {
		display: flex;
		gap: 8px;
		align-items: center;
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
	}

	.header-meta {
		display: flex;
		gap: 8px;
		align-items: center;
		color: #6b7280;
		margin-top: 8px;
	}
	.header-meta .meta-label {
		font-weight: 600;
		color: #374151;
		margin-right: 6px;
	}
	.header-meta .meta-value {
		font-weight: 700;
		color: #111827;
	}
	.btn-link {
		background: transparent;
		border: 0;
		color: #2c507b;
		cursor: pointer;
		padding: 6px;
		border-radius: 8px;
	}
	.rate-input {
		width: 120px;
		padding: 8px;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}
</style>
