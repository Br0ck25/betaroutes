<script lang="ts">
	import ExportView from '$lib/components/data/ExportView.svelte';
	import ImportView from '$lib/components/data/ImportView.svelte';
	import { page } from '$app/stores';

	// Allow deep linking via ?tab=import
	let activeTab = $page.url.searchParams.get('tab') === 'import' ? 'import' : 'export';

	function setTab(tab: string) {
		activeTab = tab;
		// Optional: Update URL without reload
		const url = new URL(window.location.href);
		url.searchParams.set('tab', tab);
		window.history.pushState({}, '', url);
	}
</script>

<svelte:head>
	<title>Data Management - Go Route Yourself</title>
</svelte:head>

<div class="data-page">
	<div class="page-header">
		<div>
			<h1 class="page-title">Data Management</h1>
			<p class="page-subtitle">Import and export your trip data</p>
		</div>

		<div class="tabs">
			<button
				class="tab-btn"
				class:active={activeTab === 'export'}
				on:click={() => setTab('export')}
			>
				Export
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'import'}
				on:click={() => setTab('import')}
			>
				Import
			</button>
		</div>
	</div>

	<div class="content-area">
		{#if activeTab === 'export'}
			<ExportView />
		{:else}
			<ImportView />
		{/if}
	</div>
</div>

<style>
	.data-page {
		max-width: 1200px;
		padding: 16px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 32px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.page-title {
		font-size: 28px;
		font-weight: 800;
		color: #111827;
		margin: 0;
		line-height: 1.2;
	}
	.page-subtitle {
		font-size: 15px;
		color: #6b7280;
		margin: 4px 0 0 0;
	}

	.tabs {
		display: flex;
		background: #e5e7eb;
		padding: 4px;
		border-radius: 12px;
		align-self: flex-start;
	}

	.tab-btn {
		padding: 10px 32px;
		border-radius: 8px;
		border: none;
		background: transparent;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 14px;
	}

	.tab-btn.active {
		background: white;
		color: #111827;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
	}

	/* Desktop */
	@media (min-width: 768px) {
		.page-header {
			flex-direction: row;
			justify-content: space-between;
			align-items: flex-end;
		}
	}
</style>
