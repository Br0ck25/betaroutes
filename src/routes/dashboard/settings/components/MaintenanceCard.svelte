<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { trips } from '$lib/stores/trips';
  import { toasts } from '$lib/stores/toast';
  import { calculateDashboardStats } from '$lib/utils/dashboardLogic';
  import { onMount } from 'svelte';

  // Editable inputs (local) to avoid overwriting during typing
  let intervalMilesInput: number | undefined;
  let lastServiceOdometerInput: number | undefined;
  let lastServiceDateInput: string | undefined;
  let reminderThresholdMilesInput: number | undefined;
  let vehicleOdometerStartInput: number | undefined;

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
  $: baseOdo = Number(vehicleOdometerStartInput != null ? vehicleOdometerStartInput : ($userSettings.vehicleOdometerStart || 0));
  $: currentOdometer = baseOdo + (allStats?.totalMiles || 0);

  async function saveSettings() {
    try {
      const payload: any = {
        serviceIntervalMiles: Number(intervalMilesInput || 5000),
        lastServiceOdometer: Number(lastServiceOdometerInput || 0),
        lastServiceDate: lastServiceDateInput || '',
        reminderThresholdMiles: Number(reminderThresholdMilesInput || 500),
        vehicleOdometerStart: Number(vehicleOdometerStartInput || 0)
      };

      userSettings.update((s) => ({ ...s, ...payload }));

      // Persist to server
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload })
      });
      if (!res.ok) throw new Error('Failed to save settings');
      toasts.success('Maintenance settings saved');
    } catch (e) {
      console.error(e);
      toasts.error('Could not save maintenance settings');
    }
  }

  async function markServicedNow() {
    lastServiceOdometerInput = Math.round(currentOdometer || 0);
    lastServiceDateInput = new Date().toISOString();
    await saveSettings();
  }
</script>

<div class="settings-card">
  <div class="card-header">
    <div class="card-icon teal">🔧</div>
    <div>
      <h2 class="card-title">Maintenance</h2>
      <p class="card-subtitle">Service interval & last service</p>
    </div>
  </div>

  <div class="form-group">
    <label for="interval-miles">Service interval (miles)</label>
    <input id="interval-miles" type="number" bind:value={intervalMilesInput} min="0" />
  </div>

  <div class="form-group">
    <label for="vehicle-odo">Vehicle odometer start</label>
    <input id="vehicle-odo" type="number" bind:value={vehicleOdometerStartInput} min="0" />
    <div class="small-note" style="margin-top:6px; color:#6b7280;">Set your vehicle's odometer at the time you started using the app (or your real odometer).</div>
  </div>

  <div class="form-group">
    <label for="last-odo">Last service odometer</label>
    <input id="last-odo" type="number" bind:value={lastServiceOdometerInput} min="0" />
  </div>

  <div class="form-group">
    <label for="reminder-threshold">Reminder threshold (miles)</label>
    <input id="reminder-threshold" type="number" bind:value={reminderThresholdMilesInput} min="0" />
    <div class="small-note" style="margin-top:6px; color:#6b7280;">Notify when the service is within this many miles</div>
  </div>

  <div class="form-group small">
    <div class="field-label">Current estimated odometer</div>
    <div class="small-note">{Math.round(currentOdometer || 0).toLocaleString()} mi</div>
  </div>

  <div class="form-actions">
    <button class="btn-secondary" on:click={saveSettings}>Save</button>
    <button class="btn-primary" on:click={markServicedNow}>Mark serviced now</button>
  </div>
</div>

<style>
  .settings-card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
  .card-header { display:flex; gap:12px; align-items:center; margin-bottom:12px; }
  .card-icon.teal { background: #ccfbf1; color:#065f46; padding:8px; border-radius:8px; font-size:16px; }
  .card-title { font-size:16px; font-weight:700; margin:0; }
  .card-subtitle { font-size:13px; color:#6b7280; margin:0; }
  .form-group { margin-bottom:12px; }
  .form-group label { display:block; font-size:13px; margin-bottom:6px; font-weight:600; }
  .form-group input { width:220px; padding:8px 10px; border-radius:8px; border:1px solid #e5e7eb; }
  .form-group.small .small-note { font-size:14px; color:#374151; }
  .form-actions { display:flex; gap:8px; margin-top:12px; }
  .btn-primary { background:#ff6a3d; color:white; border-radius:8px; padding:8px 12px; border:none; font-weight:700; }
  .btn-secondary { background:white; color:#374151; border-radius:8px; padding:8px 12px; border:1px solid #e5e7eb; }
</style>