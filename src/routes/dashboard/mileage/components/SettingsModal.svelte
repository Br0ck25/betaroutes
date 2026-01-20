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
			const rate = Number(settings.mileageRate || 0);
			settings.mileageRate = Number(isNaN(rate) ? 0 : Number(rate.toFixed(3)));
			userSettings.set(settings);
			const result = await saveSettings({ mileageRate: settings.mileageRate });
			if (!result.ok) throw new Error(result.error);
			toasts.success('Mileage defaults saved');
			dispatch('success');
			open = false;
		} catch (e) {
			console.error('Failed to save mileage defaults', e);
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

<Modal bind:open title="Mileage Settings">
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
			<div class="settings-form space-y-4">
				<p class="text-sm text-gray-500 mb-2">Pre-fill new mileage logs with these values.</p>

				<div class="form-group">
					<label for="default-mileage" class="block text-sm font-medium text-gray-700 mb-1"
						>Mileage Rate (per mile)</label
					>
					<input
						id="default-mileage"
						step="0.001"
						bind:value={settings.mileageRate}
						placeholder="0.00"
						class="w-full p-2 border rounded-lg"
					/>
				</div>

				<div class="modal-actions pt-4">
					<button class="btn-primary w-full save-btn" on:click={saveDefaultSettings}
						>Save Defaults</button
					>
				</div>
			</div>
		{:else}
			<div class="vehicles-list">
				<p class="text-sm text-gray-500 mb-2">Add vehicles to associate with mileage logs.</p>
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

				<div class="modal-actions mt-6">
					<button class="btn-cancel w-full" on:click={() => (open = false)}>Done</button>
				</div>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.top-tabs {
		display: flex;
		border-bottom: 2px solid #e5e7eb;
		margin-bottom: 20px;
	}
	.top-tab-btn {
		flex: 1;
		padding: 12px;
		font-weight: 600;
		color: #6b7280;
		border: none;
		background: none;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
	}
	.top-tab-btn.active {
		color: #ff7f50;
		border-bottom-color: #ff7f50;
	}
	.settings-form .form-group {
		margin-bottom: 12px;
	}
	.settings-form input:focus {
		outline: none;
		border-color: #ff7f50;
		box-shadow: 0 0 0 4px rgba(255, 127, 80, 0.08);
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
</style>
