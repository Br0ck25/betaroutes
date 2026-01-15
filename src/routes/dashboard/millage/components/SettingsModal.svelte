<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { userSettings } from '$lib/stores/userSettings';
	import { toasts } from '$lib/stores/toast';
	import { createEventDispatcher } from 'svelte';
	import { saveSettings } from '../../settings/lib/save-settings';

	export let open = false;
	const dispatch = createEventDispatcher();

	let settings: any = { ...$userSettings };
	let settingsTab: 'defaults' | 'vehicles' = 'defaults';
	let newVehicleName = '';

	$: if (open) {
		settings = { ...$userSettings };
	}

	async function saveDefaultSettings() {
		try {
			const rate = Number(settings.millageRate || 0);
			settings.millageRate = Number(isNaN(rate) ? 0 : Number(rate.toFixed(3)));
			userSettings.set(settings);
			const result = await saveSettings({ millageRate: settings.millageRate });
			if (!result.ok) throw new Error(result.error);
			toasts.success('Millage defaults saved');
			dispatch('success');
			open = false;
		} catch (e) {
			console.error('Failed to save millage defaults', e);
			toasts.error('Saved locally, but cloud sync failed');
		}
	}

	async function updateVehicles(newVehicles: any[]) {
		userSettings.update((s) => ({ ...s, vehicles: newVehicles }));
		try {
			const result = await saveSettings({ vehicles: newVehicles });
			if (!result.ok) throw new Error(result.error);
			toasts.success('Vehicles saved');
		} catch (e) {
			console.error('Failed to sync vehicles', e);
			toasts.error('Saved locally, but cloud sync failed');
		}
	}

	function addVehicle() {
		if (!newVehicleName.trim()) return;
		const v = { id: crypto.randomUUID(), name: newVehicleName.trim() };
		const list = settings.vehicles ? [...settings.vehicles, v] : [v];
		settings.vehicles = list;
		updateVehicles(list);
		newVehicleName = '';
	}

	function removeVehicle(id: string) {
		if (!confirm('Remove this vehicle?')) return;
		const list = (settings.vehicles || []).filter((v: any) => v.id !== id);
		settings.vehicles = list;
		updateVehicles(list);
	}
</script>

<Modal bind:open title="Millage Settings">
	<div class="settings-modal-content">
		<div class="top-tabs">
			<button
				class="top-tab-btn"
				class:active={settingsTab === 'defaults'}
				on:click={() => (settingsTab = 'defaults')}>Defaults</button
			>
			<button
				class="top-tab-btn"
				class:active={settingsTab === 'vehicles'}
				on:click={() => (settingsTab = 'vehicles')}>Vehicles</button
			>
		</div>

		{#if settingsTab === 'defaults'}
			<div class="settings-form">
				<p class="text-sm text-gray-500 mb-2">Default millage rate used for new logs.</p>
				<div class="form-group">
					<label for="default-millage" class="block text-sm font-medium text-gray-700 mb-1"
						>Millage Rate (per mile)</label
					>
					<input
						id="default-millage"
						type="number"
						step="0.001"
						bind:value={settings.millageRate}
						class="w-full p-2 border rounded-lg"
					/>
				</div>

				<div class="form-actions" style="margin-top:12px;">
					<button class="btn-secondary" on:click={() => (open = false)}>Cancel</button>
					<button class="btn-primary" on:click={saveDefaultSettings}>Save Defaults</button>
				</div>
			</div>
		{:else}
			<div class="vehicles-list">
				<p class="text-sm text-gray-500 mb-2">Add vehicles to associate with millage logs.</p>
				<div class="form-group">
					<label for="new-vehicle" class="block text-sm font-medium text-gray-700 mb-1"
						>Add Vehicle</label
					>
					<div style="display:flex;gap:8px;">
						<input
							id="new-vehicle"
							type="text"
							bind:value={newVehicleName}
							placeholder="e.g., 2019 Ford F-150"
							class="w-full p-2 border rounded-lg"
						/>
						<button class="btn-primary" on:click={addVehicle}>Add</button>
					</div>
				</div>

				<ul class="space-y-2 mt-4">
					{#each settings.vehicles || [] as v}
						<li class="flex justify-between items-center p-2 border rounded-lg">
							<div>{v.name}</div>
							<button class="btn-small neutral" on:click={() => removeVehicle(v.id)}>Remove</button>
						</li>
					{/each}
					{#if !(settings.vehicles && settings.vehicles.length)}
						<li class="text-sm text-gray-500">No vehicles added yet.</li>
					{/if}
				</ul>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.top-tabs {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
	}
	.top-tab-btn {
		padding: 8px 12px;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
	}
	.top-tab-btn.active {
		background: #ffedd5;
	}
	.settings-form .form-group {
		margin-bottom: 12px;
	}
	.btn-primary {
		background: linear-gradient(135deg, #ff7f50 0%, #ff6a3d 100%);
		color: white;
		padding: 8px 12px;
		border-radius: 8px;
		border: none;
	}
	.btn-secondary {
		background: white;
		border: 1px solid #e5e7eb;
		padding: 8px 12px;
		border-radius: 8px;
	}
	.btn-small.neutral {
		background: white;
		border: 1px solid #e5e7eb;
		padding: 6px 8px;
		border-radius: 6px;
	}
</style>
