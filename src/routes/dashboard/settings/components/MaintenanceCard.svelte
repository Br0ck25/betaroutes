<script lang="ts">
  import { run } from 'svelte/legacy';

  import { toasts } from '$lib/stores/toast';
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { calculateDashboardStats } from '$lib/utils/dashboardLogic';
  import { localDateISO } from '$lib/utils/dates';

  // Callback prop instead of createEventDispatcher
  const { onSuccess }: { onSuccess?: (msg: string) => void } = $props();

  // Editable inputs (local) to avoid overwriting during typing
  let intervalMilesInput: number | undefined = $state();
  let lastServiceOdometerInput: number | undefined = $state();
  let lastServiceDateInput: string | undefined;
  let reminderThresholdMilesInput: number | undefined = $state();
  let vehicleOdometerStartInput: number | undefined = $state();

  // Visual feedback for the Save button
  let buttonHighlight = $state(false);

  // Initialize inputs from the store (use $effect instead of onMount)
  $effect(() => {
    intervalMilesInput = Number($userSettings.serviceIntervalMiles || 5000);
    lastServiceOdometerInput = Number($userSettings.lastServiceOdometer || 0);
    lastServiceDateInput = $userSettings.lastServiceDate || '';
    reminderThresholdMilesInput = Number($userSettings.reminderThresholdMiles || 500);
    vehicleOdometerStartInput = Number($userSettings.vehicleOdometerStart || 0);
  });

  // Current odometer computed from trips + vehicleOdometerStart (reflects unsaved input while editing)
  let baseOdo = $state(0);
  let currentOdometer = $state(0);
  const allStats = $derived(calculateDashboardStats($trips, [], 'all'));
  run(() => {
    baseOdo = Number(
      vehicleOdometerStartInput != null
        ? vehicleOdometerStartInput
        : $userSettings.vehicleOdometerStart || 0
    );
  });
  run(() => {
    currentOdometer = baseOdo + (allStats?.totalMiles || 0);
  });

  import CollapsibleCard from '$lib/components/ui/CollapsibleCard.svelte';
  import { saveSettings } from '../lib/save-settings';

  async function saveSettingsHandler() {
    try {
      const payload: Record<string, unknown> = {
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
      // Use callback prop instead of dispatch
      onSuccess?.('Maintenance settings saved');
      buttonHighlight = true;
      setTimeout(() => (buttonHighlight = false), 3000);
    } catch (e: unknown) {
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
  {#snippet icon()}
    <span>🔧</span>
  {/snippet}

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
      onclick={saveSettingsHandler}>Save</button
    >
    <button class="btn-primary" onclick={markServicedNow}>Mark serviced now</button>
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
