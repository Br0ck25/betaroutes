<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ArchivedRestore from './ArchivedRestore.svelte';

	export let isConnected = false;
	export let ordersCount = 0;
	export let loading = false;
	export let statusMessage = 'Sync Now';
	export let currentBatch = 0;

	let username = '';
	let password = '';
	const dispatch = createEventDispatcher();

	// Local UI toggle for showing restore panel
	let showRestore = false;

	function handleConnect() {
		dispatch('connect', { username, password });
	}
</script>

<div class="settings-card">
	<div class="card-header">
		<div class="card-icon blue">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M10 2C13.97 2 18 6.03 18 11C18 15.97 13.97 20 9 20H2V13C2 8.03 6.03 4 11 4H18V11C18 6.03 13.97 2 9 2Z"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</div>
		<div>
			<h2 class="card-title">Connection</h2>
			<p class="card-subtitle">{isConnected ? 'Connected to HughesNet' : 'Link your account'}</p>
		</div>
	</div>

	{#if !isConnected && ordersCount === 0}
		<div class="form-group">
			<label for="hn-username">Username</label>
			<input id="hn-username" type="text" bind:value={username} placeholder="HughesNet Username" />
		</div>

		<div class="form-group">
			<label for="hn-password">Password</label>
			<input
				id="hn-password"
				type="password"
				bind:value={password}
				placeholder="HughesNet Password"
			/>
		</div>

		<button class="btn-primary" on:click={handleConnect} disabled={loading}>
			{statusMessage === 'Sync Now' ? 'Connect' : statusMessage}
		</button>
	{:else}
		<div class="success-state">
			<div class="status-indicator">
				<span class="dot"></span> Connected
			</div>
			<p class="last-sync">Found {ordersCount} active orders in cache.</p>
		</div>

		<div class="warning-box">
			<p>
				⚠️ <strong>Important:</strong> Before syncing, please ensure your Start Address and MPG
				defaults are updated in <a href="/dashboard/settings">Global Settings</a>.
			</p>
		</div>

		{#if loading && currentBatch > 0}
			<div class="sync-progress-container">
				<div class="progress-info">
					<span class="progress-label">Syncing Batch {currentBatch}</span>
					<span class="progress-sub">Fetching orders...</span>
				</div>
				<div class="progress-bar">
					<div class="progress-fill indeterminate"></div>
				</div>
			</div>
		{:else}
			<div class="button-group mt-4">
				<button class="btn-primary" on:click={() => dispatch('sync')} disabled={loading}>
					<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						></path></svg
					>
					{statusMessage}
				</button>

				<button class="btn-secondary" on:click={() => dispatch('disconnect')} disabled={loading}>
					Disconnect
				</button>

				<button
					class="btn-secondary danger-hover"
					on:click={() => dispatch('clear')}
					disabled={loading}
				>
					Delete HNS Trips
				</button>

				<!-- Restore Archived Orders -->
				<button
					class="btn-secondary"
					on:click={() => (showRestore = !showRestore)}
					disabled={loading}
				>
					{showRestore ? 'Hide Archived' : 'Restore Archived Orders'}
				</button>
			</div>
		{/if}

		{#if showRestore}
			<div class="mt-4">
				<ArchivedRestore
					on:restored={() => {
						dispatch('reloaded');
					}}
					on:restoreAndSync={(e) => dispatch('restoreAndSync', e.detail)}
				/>
			</div>
		{/if}
	{/if}
</div>

<style>
	.settings-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 24px;
	}
	.card-header {
		display: flex;
		gap: 16px;
		margin-bottom: 24px;
		padding-bottom: 20px;
		border-bottom: 1px solid #e5e7eb;
	}
	.card-icon {
		width: 48px;
		height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		flex-shrink: 0;
	}
	.card-icon.blue {
		background: linear-gradient(135deg, #3b82f6 0%, #1e9bcf 100%);
	}
	.card-title {
		font-size: 18px;
		font-weight: 700;
		color: #111827;
		margin-bottom: 4px;
	}
	.card-subtitle {
		font-size: 14px;
		color: #6b7280;
	}

	.form-group {
		margin-bottom: 20px;
	}
	.form-group label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: #374151;
		margin-bottom: 8px;
	}
	.form-group input {
		width: 100%;
		padding: 12px 16px;
		border: 2px solid #e5e7eb;
		border-radius: 10px;
		font-size: 15px;
		background: white;
		transition: all 0.2s;
		box-sizing: border-box;
	}
	.form-group input:focus {
		outline: none;
		border-color: #f97316;
		box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
	}

	.btn-primary,
	.btn-secondary {
		width: 100%;
		padding: 14px;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 15px;
	}
	.btn-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #f97316 0%, #ff6a3d 100%);
		color: white;
		border: none;
	}
	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3);
	}
	.btn-primary:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}
	.btn-secondary {
		background: white;
		color: #374151;
		border: 2px solid #e5e7eb;
	}
	.btn-secondary:hover {
		border-color: #f97316;
		color: #f97316;
	}
	.btn-secondary.danger-hover:hover {
		border-color: #dc2626;
		color: #dc2626;
	}

	.button-group {
		display: flex;
		gap: 12px;
	}
	.mt-4 {
		margin-top: 16px;
	}

	.sync-progress-container {
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 12px;
		padding: 16px;
		text-align: center;
		margin-top: 16px;
	}
	.progress-info {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 8px;
	}
	.progress-label {
		font-weight: 700;
		color: #9a3412;
		font-size: 14px;
	}
	.progress-sub {
		color: #c2410c;
		font-size: 12px;
	}
	.progress-bar {
		height: 8px;
		background: #ffedd5;
		border-radius: 4px;
		overflow: hidden;
		position: relative;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #f97316, #ea580c);
		border-radius: 4px;
		width: 30%;
	}
	.progress-fill.indeterminate {
		width: 50%;
		animation: pulse-progress 1.5s infinite ease-in-out;
	}

	@keyframes pulse-progress {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(200%);
		}
	}

	.success-state {
		padding: 20px;
		background: #f0fdf4;
		border: 1px solid #bbf7d0;
		border-radius: 12px;
		text-align: center;
	}
	.status-indicator {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		color: #166534;
		font-size: 16px;
	}
	.dot {
		width: 8px;
		height: 8px;
		background: #166534;
		border-radius: 50%;
		display: inline-block;
	}
	.last-sync {
		color: #15803d;
		font-size: 14px;
		margin-top: 4px;
	}
	.warning-box {
		margin: 16px 0;
		padding: 12px;
		background: #fff7ed;
		border: 1px solid #fed7aa;
		border-radius: 8px;
		font-size: 13px;
		color: #9a3412;
	}
	.warning-box a {
		color: #c2410c;
		text-decoration: underline;
		font-weight: 600;
	}
</style>
