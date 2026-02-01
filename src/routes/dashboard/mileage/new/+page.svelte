<script lang="ts">
  import type { MileageRecord } from '$lib/db/types';
  import { mileage } from '$lib/stores/mileage';

  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import SelectMobile from '$lib/components/ui/SelectMobile.svelte';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import { userSettings } from '$lib/stores/userSettings';
  import { getErrorMessage } from '$lib/utils/errors';

  // --- HELPER: Get Local Date (YYYY-MM-DD) ---
  function getLocalDate() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  }

  // Settings modal removed for Mileage logs

  const formData = $state({
    date: getLocalDate(),
    startOdometer: '',
    endOdometer: '',
    miles: '',
    vehicle: '',
    mileageRate: '',
    notes: '',
    category: ''
  });

  // Reference to miles input so quick-action can focus it
  let amountInput: HTMLInputElement | null = $state(null);
  // Whether the user manually edited the miles input; when true we stop auto-updating miles from odometers
  let milesManual = $state(false);

  // default mileageRate from user settings for new logs (only set if field empty)
  $effect(() => {
    if ($userSettings && formData.mileageRate === '') {
      formData.mileageRate =
        $userSettings.mileageRate != null ? String($userSettings.mileageRate) : '';
    }
  });

  // Default vehicle selection if available and none selected
  $effect(() => {
    if ($userSettings?.vehicles?.length > 0 && !formData.vehicle) {
      const v0 = $userSettings.vehicles[0];
      formData.vehicle = String(v0?.id ?? v0?.name ?? '');
    }
  });

  // Prefill category from the URL query parameter (e.g., ?category=fuel)
  $effect(() => {
    const q = $page.url.searchParams.get('category');
    if (q) {
      formData.category = q;
      // if arrived via quick action, focus the miles input for quick logging
      if (typeof window !== 'undefined') {
        setTimeout(() => amountInput?.focus(), 60);
      }
    }
  });

  // Auto-calc miles from odometer readings unless the user has manually edited miles
  $effect(() => {
    if (!milesManual) {
      if (formData.startOdometer !== '' && formData.endOdometer !== '') {
        const s = Number(formData.startOdometer) || 0;
        const e = Number(formData.endOdometer) || 0;
        formData.miles = Number(Math.max(0, e - s).toFixed(2)).toString();
      }
    }
  });

  async function saveExpense() {
    if (
      !formData.date ||
      ((formData.startOdometer === '' || formData.endOdometer === '') && formData.miles === '')
    ) {
      toasts.error('Please fill in required fields (either start & end odometer or miles).');
      return;
    }

    const userId = $user?.id || localStorage.getItem('offline_user_id');

    if (!userId) {
      toasts.error('User not identified. Cannot save.');
      return;
    }

    try {
      const start = Number(formData.startOdometer) || 0;
      const end = Number(formData.endOdometer) || 0;
      let miles =
        formData.miles !== '' && !isNaN(Number(formData.miles))
          ? Number(formData.miles)
          : Math.max(0, end - start);
      miles = Number(miles.toFixed(2));

      const payload: Partial<MileageRecord> = {
        date: String(formData.date || ''),
        startOdometer: start,
        endOdometer: end,
        miles,
        vehicle: String(formData.vehicle ?? ''),
        notes: String(formData.notes || ''),
        category: String(formData.category || '')
      };

      // Only include mileageRate when provided to satisfy exactOptionalPropertyTypes
      if (formData.mileageRate !== '') {
        payload.mileageRate = Number(formData.mileageRate);
      }

      await mileage.create(payload, String(userId));
      toasts.success('Mileage log created');
      await invalidateAll();

      void goto(resolve('/dashboard/mileage'));
    } catch (err: unknown) {
      console.error('Create mileage failed', getErrorMessage(err));
      toasts.error('Failed to save mileage log');
    }
  }
</script>

<div class="expense-form-page">
  <div class="page-header">
    <div>
      <h1 class="page-title">New Mileage Log</h1>
      <p class="page-subtitle">Record start/end odometer and miles</p>
    </div>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
    <a href={resolve('/dashboard/mileage')} class="btn-back">
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none"
        ><path
          d="M12 4L6 10L12 16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      > Back
    </a>
  </div>

  <div class="form-card">
    <div class="card-header">
      <h2 class="card-title">Mileage Details</h2>
    </div>

    <div class="form-grid">
      <div class="form-group">
        <label for="mileage-date">Date</label>
        <input id="mileage-date" type="date" bind:value={formData.date} required />
      </div>

      <div class="form-row">
        <!-- Maintenance, Supplies, and Expenses options removed for Mileage logs -->

        <div class="form-group grid-3">
          <div>
            <label for="start-odo">Start Odometer</label>
            <input
              id="start-odo"
              type="number"
              inputmode="decimal"
              bind:value={formData.startOdometer}
              placeholder="0"
            />
          </div>
          <div>
            <label for="end-odo">End Odometer</label>
            <input
              id="end-odo"
              type="number"
              inputmode="decimal"
              bind:value={formData.endOdometer}
              placeholder="0"
            />
          </div>
          <div>
            <label for="miles">Miles</label>
            <input
              id="miles"
              type="number"
              step="0.01"
              inputmode="decimal"
              bind:this={amountInput}
              bind:value={formData.miles}
              placeholder="0.0"
              oninput={(e) => (milesManual = (e.target as HTMLInputElement).value !== '')}
            />
          </div>
        </div>
      </div>

      <div class="form-group">
        <label for="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          bind:value={formData.notes}
          rows="3"
          placeholder="e.g., Trip to client site"
        ></textarea>

        <!-- tax deductible removed -->
      </div>

      <!-- Settings modal removed for Mileage logs -->

      <div class="form-row vehicle-rate-row">
        <div class="form-group">
          <label for="vehicle-mobile">Vehicle</label>
          <SelectMobile
            className="mobile-select"
            id="vehicle-mobile"
            placeholder={$userSettings.vehicles && $userSettings.vehicles.length > 0
              ? 'Select vehicle'
              : 'No vehicles (open Mileage Settings)'}
            options={$userSettings.vehicles
              ? $userSettings.vehicles.map((v) => ({ value: v.id || v.name, label: v.name }))
              : [{ value: '', label: 'No vehicles (open Mileage Settings)' }]}
            bind:value={formData.vehicle}
            onchange={(e) => (formData.vehicle = e.value)}
          />
        </div>
        <div class="form-group">
          <label for="mileage-rate">Mileage Rate (per mile)</label>
          <input
            id="mileage-rate"
            type="number"
            step="0.001"
            bind:value={formData.mileageRate}
            placeholder="0.655"
          />
        </div>
      </div>

      <div class="form-actions">
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- using local resolve() helper (base-aware) -->
        <a href={resolve('/dashboard/mileage')} class="btn-secondary">Cancel</a>
        <button class="btn-primary" onclick={saveExpense}>Save Log</button>
      </div>
    </div>
  </div>
</div>

<style>
  /* MATCHING STYLES FROM TRIPS/NEW */
  .expense-form-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 4px;
    padding-bottom: 90px;
  }

  @media (max-width: 640px) {
    .expense-form-page {
      padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1px);
    }
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 26px;
    padding: 0 8px;
  }
  .page-title {
    font-size: 28px;
    font-weight: 800;
    color: #111827;
    margin: 0;
  }
  .page-subtitle {
    font-size: 14px;
    color: #6b7280;
    display: none;
    margin: 0;
  }

  .btn-back {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #6b7280;
    text-decoration: none;
    font-size: 14px;
  }

  .form-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }
  .card-header {
    margin-bottom: 26px;
  }
  .card-title {
    font-size: 22px;
    font-weight: 700;
    color: #111827;
    margin: 0;
  }

  .form-grid {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  /* Make the start/end/miles group span the full width (match Date input) */
  .form-row .grid-3 {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }
  @media (max-width: 767px) {
    .form-row .grid-3 {
      grid-template-columns: 1fr;
    }
  }

  /* Force mileage rate below vehicle on small screens <= 711px */
  @media (max-width: 711px) {
    .vehicle-rate-row {
      grid-template-columns: 1fr;
    }
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

  input,
  textarea {
    width: 100%;
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    font-size: 18px;
    background: white;
    box-sizing: border-box;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: #ff7f50;
  }

  .form-actions {
    display: flex;
    gap: 18px;
    margin-top: 36px;
    padding-top: 26px;
    border-top: 1px solid #e5e7eb;
  }
  .btn-primary,
  .btn-secondary {
    flex: 1;
    padding: 18px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 18px;
    cursor: pointer;
    border: none;
    text-align: center;
    text-decoration: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .btn-primary {
    background: linear-gradient(135deg, #ff7f50 0%, #ff6a3d 100%);
    color: white;
  }
  .btn-secondary {
    background: white;
    border: 1px solid #e5e7eb;
    color: #374151;
  }

  @media (min-width: 768px) {
    .page-subtitle {
      display: block;
    }
    .form-card {
      padding: 48px;
    }
    .form-actions {
      justify-content: flex-end;
    }
    .btn-primary,
    .btn-secondary {
      flex: 0 0 auto;
      width: auto;
      min-width: 160px;
    }
  }
</style>
