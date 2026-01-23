<script lang="ts">
	import { cleanupOrphanedMileage } from '$lib/utils/cleanup-orphaned-mileage';
	import { mileage } from '$lib/stores/mileage';
	import { page } from '$app/stores';

	let isScanning = $state(false);
	let scanResult = $state<{
		scanned: number;
		orphaned: number;
		removed: number;
		orphanedRecords: any[];
	} | null>(null);
	let error = $state<string | null>(null);

	async function runCleanup() {
		const user = $page.data?.['user'];
		if (!user?.id) {
			error = 'No user logged in. Please refresh the page.';
			console.error('User data:', user);
			return;
		}

		console.log('Starting cleanup for user:', user.id);
		isScanning = true;
		error = null;
		scanResult = null;

		try {
			const result = await cleanupOrphanedMileage(user.id);
			console.log('Cleanup result:', result);
			scanResult = result;

			// Reload mileage store to reflect changes
			if (result.removed > 0) {
				await mileage.load(user.id);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to scan for orphaned records';
			console.error('Cleanup error:', err);
		} finally {
			isScanning = false;
		}
	}
</script>

<div class="orphan-cleanup-card">
	<div class="header">
		<h3>🧹 Clean Up Orphaned Mileage Logs</h3>
		<p class="description">
			Remove mileage logs that exist in your browser but not on the server. These are typically
			"ghost" records that keep reappearing after deletion.
		</p>
	</div>

	<div class="actions">
		<button class="scan-button" onclick={runCleanup} disabled={isScanning}>
			{#if isScanning}
				<span class="spinner"></span>
				Scanning...
			{:else}
				Scan & Clean Up
			{/if}
		</button>
	</div>

	{#if scanResult}
		<div class="results">
			<h4>Scan Results</h4>
			<ul>
				<li>Total mileage logs scanned: <strong>{scanResult.scanned}</strong></li>
				<li>Valid records: <strong>{scanResult.scanned - scanResult.orphaned}</strong></li>
				<li>Orphaned records found: <strong>{scanResult.orphaned}</strong></li>
				<li>Records removed: <strong>{scanResult.removed}</strong></li>
			</ul>

			{#if scanResult.removed > 0}
				<p class="success-message">
					✅ Successfully removed {scanResult.removed} orphaned mileage log{scanResult.removed !== 1
						? 's'
						: ''}. Please refresh the page to see updated data.
				</p>
			{:else if scanResult.orphaned === 0}
				<p class="success-message">✅ No orphaned records found. Your data is clean!</p>
			{/if}

			{#if scanResult.orphanedRecords.length > 0}
				<details class="orphan-details">
					<summary>View Orphaned Records ({scanResult.orphanedRecords.length})</summary>
					<ul class="orphan-list">
						{#each scanResult.orphanedRecords as record}
							<li>
								<strong>ID:</strong>
								{record.id}
								<br />
								<strong>Date:</strong>
								{new Date(record.date || record.createdAt).toLocaleDateString()}
								<br />
								<strong>Miles:</strong>
								{record.miles}
								<br />
								{#if record.tripId}
									<strong>Parent Trip:</strong>
									{record.tripId}
									<br />
								{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	{/if}

	{#if error}
		<div class="error-message">❌ {error}</div>
	{/if}
</div>

<style>
	.orphan-cleanup-card {
		background: #ffffff;
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 1.5rem;
		margin: 1rem 0;
	}

	.header h3 {
		color: #2c507b;
		margin: 0 0 0.5rem 0;
		font-size: 1.25rem;
	}

	.description {
		color: #333333;
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}

	.actions {
		margin: 1rem 0;
	}

	.scan-button {
		background: #f68a2e;
		color: #ffffff;
		border: none;
		border-radius: 6px;
		padding: 0.75rem 1.5rem;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		transition: background 0.2s;
	}

	.scan-button:hover:not(:disabled) {
		background: #e57a1e;
	}

	.scan-button:disabled {
		background: #e0e0e0;
		color: #333333;
		cursor: not-allowed;
	}

	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid #ffffff;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.results {
		background: #f5f5f5;
		border-radius: 6px;
		padding: 1rem;
		margin-top: 1rem;
	}

	.results h4 {
		color: #2c507b;
		margin: 0 0 0.75rem 0;
		font-size: 1.1rem;
	}

	.results ul {
		margin: 0;
		padding-left: 1.5rem;
		color: #333333;
	}

	.results li {
		margin: 0.5rem 0;
	}

	.success-message {
		background: #8bc12d;
		color: #ffffff;
		padding: 0.75rem;
		border-radius: 6px;
		margin-top: 1rem;
		font-weight: 600;
	}

	.error-message {
		background: #ff4444;
		color: #ffffff;
		padding: 0.75rem;
		border-radius: 6px;
		margin-top: 1rem;
		font-weight: 600;
	}

	.orphan-details {
		margin-top: 1rem;
		border-top: 1px solid #e0e0e0;
		padding-top: 1rem;
	}

	.orphan-details summary {
		color: #2c507b;
		font-weight: 600;
		cursor: pointer;
		padding: 0.5rem;
	}

	.orphan-details summary:hover {
		background: #f5f5f5;
		border-radius: 4px;
	}

	.orphan-list {
		list-style: none;
		padding: 0;
		margin-top: 1rem;
	}

	.orphan-list li {
		background: #ffffff;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
		padding: 0.75rem;
		margin: 0.5rem 0;
		font-size: 0.9rem;
		color: #333333;
	}

	.orphan-list li strong {
		color: #2c507b;
	}
</style>
