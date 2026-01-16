<script lang="ts">
	import { userSettings } from '$lib/stores/userSettings';
	import { trips } from '$lib/stores/trips';
	import { toasts } from '$lib/stores/toast';
	import { calculateDashboardStats } from '$lib/utils/dashboardLogic';
	import { onMount, createEventDispatcher } from 'svelte';
	import { localDateISO } from '$lib/utils/dates';

	const dispatch = createEventDispatcher();

	// Editable inputs (local) to avoid overwriting during typing
	let intervalMilesInput: number | undefined;
	let lastServiceOdometerInput: number | undefined;
	let lastServiceDateInput: string | undefined;
	let reminderThresholdMilesInput: number | undefined;
	let vehicleOdometerStartInput: number | undefined;

	// Visual feedback for the Save button
	let buttonHighlight = false;

	// Initialize inputs from the store on mount
	onMount(() => {
		intervalMilesInput = Number($userSettings.serviceIntervalMiles || 5000);
		lastServiceOdometerInput = Number($userSettings.lastServiceOdometer || 0);
		lastServiceDateInput = $userSettings.lastServiceDate || '';
		reminderThresholdMilesInput = Number($userSettings.reminderThresholdMiles || 500);
		vehicleOdometerStartInput = Number($userSettings.vehicleOdometerStart || 0);
	});

	// Current odometer computed from trips + vehicleOdometerStart (reflects unsaved input while editing)
	let baseOdo = 0;
	let currentOdometer = 0;
	$: allStats = calculateDashboardStats($trips, [], 'all');
	$: baseOdo = Number(
		vehicleOdometerStartInput != null
			? vehicleOdometerStartInput
			: $userSettings.vehicleOdometerStart || 0
	);
	$: currentOdometer = baseOdo + (allStats?.totalMiles || 0);

	import { saveSettings } from '../lib/save-settings';
	import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';

	async function saveSettingsHandler() {
		try {
			const payload: any = {
				serviceIntervalMiles: Number(intervalMilesInput || 5000),
				lastServiceOdometer: Number(lastServiceOdometerInput || 0),
				lastServiceDate: lastServiceDateInput || '',
				reminderThresholdMiles: Number(reminderThresholdMilesInput || 500),
				vehicleOdometerStart: Number(vehicleOdometerStartInput || 0)
			};

			const result = await saveSettings(payload);
			if (!result.ok) throw new Error(result.error);

			// Visual & event feedback (match ProfileCard behavior)
			toasts.success('Maintenance settings saved');
			dispatch('success', 'Maintenance settings saved');
			buttonHighlight = true;
			setTimeout(() => (buttonHighlight = false), 3000);
		} catch (e: any) {
			console.error(e);
			toasts.error('Could not save maintenance settings');
		}
	}

	async function markServicedNow() {
		lastServiceOdometerInput = Math.round(currentOdometer || 0);
		lastServiceDateInput = localDateISO();
		await saveSettingsHandler();
	}
</script>

<CollapsibleCard
	title="Maintenance"
	subtitle="Service interval & last service"
	storageKey="settings:maintenance"
>
	<span slot="icon">🔧</span>

	<div class="form-group">
		<label for="interval-miles">Service interval (miles)</label>
		<input id="interval-miles" type="number" bind:value={intervalMilesInput} min="0" />
	</div>

	<div class="form-group">
		<label for="vehicle-odo">Vehicle odometer start</label>
		<input id="vehicle-odo" type="number" bind:value={vehicleOdometerStartInput} min="0" />
		<div class="small-note" style="margin-top:6px; color:#6b7280;">
			Set your vehicle's odometer at the time you started using the app (or your real odometer).
		</div>
	</div>

	<div class="form-group">
		<label for="last-odo">Last service odometer</label>
		<input id="last-odo" type="number" bind:value={lastServiceOdometerInput} min="0" />
	</div>

	<div class="form-group">
		<label for="reminder-threshold">Reminder threshold (miles)</label>
		<input id="reminder-threshold" type="number" bind:value={reminderThresholdMilesInput} min="0" />
		<div class="small-note" style="margin-top:6px; color:#6b7280;">
			Notify when the service is within this many miles
		</div>
	</div>

	<div class="form-group small">
		<div class="field-label">Current estimated odometer</div>
		<div class="small-note">{Math.round(currentOdometer || 0).toLocaleString()} mi</div>
	</div>

	<div class="form-actions">
		<button
			class="btn-secondary save-btn"
			class:highlight={buttonHighlight}
			on:click={saveSettingsHandler}>Save</button
		>
		<button class="btn-primary" on:click={markServicedNow}>Mark serviced now</button>
	</div>
</CollapsibleCard>

<style>
	.form-group {
		margin-bottom: 12px;
	}
	.form-group label {
		display: block;
		font-size: 13px;
		margin-bottom: 6px;
		font-weight: 600;
	}
	.form-group input {
		width: 100%;
		max-width: 450px;
		padding: 12px 16px;
		border-radius: 10px;
		border: 2px solid #e5e7eb;
		font-size: 16px;
		box-sizing: border-box;
	}
	.form-group.small .small-note {
		font-size: 14px;
		color: #374151;
	}
	.form-actions {
		display: flex;
		gap: 8px;
		margin-top: 12px;
		align-items: center;
	}
	.form-actions .save-btn {
		flex: 0 0 auto;
		width: 100%;
		max-width: 450px;
	}
	.form-actions .btn-primary {
		flex: 1 1 auto;
		min-width: 120px;
		padding: 12px 16px;
		border-radius: 10px;
	}
	.btn-primary {
		background: #ff6a3d;
		color: white;
		border-radius: 8px;
		padding: 8px 12px;
		border: none;
		font-weight: 700;
	}
	.btn-secondary {
		background: white;
		color: #374151;
		border-radius: 8px;
		padding: 8px 12px;
		border: 1px solid #e5e7eb;
	}

	/* Responsive: stack buttons on small screens to prevent overflow */
	@media (max-width: 640px) {
		.form-actions {
			flex-direction: column;
			align-items: stretch;
		}
		.form-actions .save-btn,
		.form-actions .btn-primary {
			width: 100%;
			max-width: 100%;
			flex: 0 0 auto;
		}
		.form-actions .save-btn {
			margin-bottom: 8px;
		}
	}
</style>
