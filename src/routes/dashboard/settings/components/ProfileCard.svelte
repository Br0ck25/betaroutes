<script lang="ts">
	import { auth } from '$lib/stores/auth';
	import { createEventDispatcher } from 'svelte';

	export let profile: { name: string; email: string };
	export let monthlyUsage: number;
	export let isPro: boolean;
	export let isOpeningPortal: boolean = false;
	export let isCheckingOut: boolean = false;

	const dispatch = createEventDispatcher();
	let buttonHighlight = false;

	async function saveProfile() {
		auth.updateProfile({ name: profile.name, email: profile.email });
		try {
			const res = await fetch('/api/user', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: profile.name, email: profile.email })
			});
			if (res.ok) {
				dispatch('success', 'Profile updated successfully!');
				buttonHighlight = true;
				setTimeout(() => (buttonHighlight = false), 3000);
			} else {
				console.error('Failed to save profile to server');
				dispatch('success', 'Saved locally (Server error)');
				buttonHighlight = true;
				setTimeout(() => (buttonHighlight = false), 3000);
			}
		} catch (e) {
			console.error('Save error:', e);
			dispatch('success', 'Saved locally (Network error)');
			buttonHighlight = true;
			setTimeout(() => (buttonHighlight = false), 3000);
		}
	}

	function handlePortal() {
		dispatch('portal');
	}

	function handleUpgrade() {
		dispatch('upgrade', 'generic');
	}
</script>

<div class="settings-card">
	<div class="card-header">
		<div class="card-icon orange">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M10 10C12.7614 10 15 7.76142 15 5C15 2.23858 12.7614 0 10 0C7.23858 0 5 2.23858 5 5C5 7.76142 7.23858 10 10 10Z"
					fill="currentColor"
				/>
				<path
					d="M10 12C4.47715 12 0 15.3579 0 19.5C0 19.7761 0.223858 20 0.5 20H19.5C19.7761 20 20 19.7761 20 19.5C20 15.3579 15.5228 12 10 12Z"
					fill="currentColor"
				/>
			</svg>
		</div>
		<div>
			<h2 class="card-title">Profile</h2>
			<p class="card-subtitle">Your account information</p>
		</div>
	</div>

	<div class="form-group">
		<label for="profile-name">Name</label>
		<input id="profile-name" type="text" bind:value={profile.name} placeholder="Your name" />
	</div>

	<div class="form-group">
		<label for="profile-email">Email</label>
		<input
			id="profile-email"
			type="email"
			bind:value={profile.email}
			placeholder="your@email.com"
		/>
	</div>

	<button class="btn-secondary save-btn" class:highlight={buttonHighlight} on:click={saveProfile}
		>Save Profile</button
	>

	<div class="divider"></div>

	<div class="plan-section">
		<div class="plan-info">
			<label for="plan-badge">Current Plan</label>
			<div class="plan-row">
				<div id="plan-badge" class="plan-badge" style="text-transform: capitalize;">
					{$auth.user?.plan || 'free'} Plan
				</div>

				{#if isPro}
					<button class="upgrade-link-btn" on:click={handlePortal} disabled={isOpeningPortal}>
						{isOpeningPortal ? 'Loading...' : 'Manage Subscription'}
					</button>
				{:else}
					<button class="upgrade-link-btn" on:click={handleUpgrade} disabled={isCheckingOut}>
						{isCheckingOut ? 'Loading...' : 'Upgrade to Pro'}
					</button>
				{/if}
			</div>
		</div>

		{#if $auth.user?.plan === 'free'}
			<div class="usage-stats">
				<div class="usage-header">
					<span>Monthly Usage</span>
					<span>{monthlyUsage} / {$auth.user?.maxTrips || 10} trips</span>
				</div>
				<div class="progress-bar">
					<div
						class="progress-fill"
						style="width: {Math.min((monthlyUsage / ($auth.user?.maxTrips || 10)) * 100, 100)}%"
						class:warning={monthlyUsage >= ($auth.user?.maxTrips || 10)}
					></div>
				</div>
			</div>
		{/if}
	</div>
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
	.card-icon.orange {
		background: linear-gradient(135deg, var(--orange, #ff6a3d) 0%, #ff6a3d 100%);
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
		max-width: 450px;
		padding: 12px 16px;
		border: 2px solid #e5e7eb;
		border-radius: 10px;
		font-size: 16px;
		display: block;
		box-sizing: border-box;
	}
	.form-group input:focus {
		outline: none;
		border-color: var(--orange, #ff6a3d);
		box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1);
	}
	.divider {
		height: 1px;
		background: #e5e7eb;
		margin: 24px 0;
	}
	.plan-row {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 4px;
	}
	.plan-badge {
		display: inline-block;
		padding: 6px 12px;
		background: #f3f4f6;
		color: #374151;
		border-radius: 8px;
		font-weight: 600;
		font-size: 14px;
	}
	.upgrade-link-btn {
		background: none;
		border: none;
		color: var(--orange, #ff6a3d);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		text-decoration: none;
	}
	.upgrade-link-btn:hover {
		text-decoration: underline;
	}
	.usage-stats {
		margin-top: 16px;
	}
	.usage-header {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: #6b7280;
		margin-bottom: 6px;
	}
	.progress-bar {
		height: 8px;
		background: #e5e7eb;
		border-radius: 4px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--green, #22c55e);
		border-radius: 4px;
		transition: width 0.3s;
	}
	.progress-fill.warning {
		background: #f59e0b;
	}
	.btn-secondary {
		width: 100%;
		padding: 14px;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 15px;
		background: white;
		color: #374151;
		border: 2px solid #e5e7eb;
	}
	.btn-secondary:hover {
		border-color: var(--orange, #ff6a3d);
		color: var(--orange, #ff6a3d);
	}
</style>
