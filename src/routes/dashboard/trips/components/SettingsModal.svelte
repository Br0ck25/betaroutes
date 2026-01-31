<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import { toasts } from '$lib/stores/toast';
  import { userSettings } from '$lib/stores/userSettings';
  import type { UserSettings } from '$lib/types';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { get } from 'svelte/store';
  import { saveSettings } from '../../settings/lib/save-settings';

  interface Props {
    open?: boolean;
    API_KEY?: string;
    activeCategoryType?: 'maintenance' | 'supplies' | 'expenses';
    initialTab?: 'defaults' | 'categories';
    onSuccess?: (message?: string) => void;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    API_KEY = '',
    activeCategoryType = $bindable<'maintenance' | 'supplies' | 'expenses'>('maintenance'),
    initialTab = 'defaults',
    onSuccess,
    onClose
  }: Props = $props();
  let settingsTab: 'defaults' | 'categories' = $state('defaults');
  let newCategoryName = $state('');
  let settings: Partial<UserSettings> = $state({ ...$userSettings });

  // Local primitives for form fields — binding directly to nested object props caused
  // inputs to appear uneditable in some browsers. Keep separate staged vars and commit
  // them to `settings` on Save.
  let defaultMPGLocal: number | string = $state('');
  let defaultStartLocal: string = $state('');
  let defaultEndLocal: string = $state('');

  /* Initialize from store only when modal is opened. We intentionally avoid a global reactive
	   copy from `$userSettings` here because it would overwrite staged overrides while the user
	   is typing in the modal and make inputs appear un-editable. */
  let activeCategories: string[] = $derived(
    activeCategoryType === 'maintenance'
      ? ($userSettings.maintenanceCategories ?? ['oil change', 'repair'])
      : activeCategoryType === 'supplies'
        ? ($userSettings.supplyCategories ?? ['water', 'snacks'])
        : ($userSettings.expenseCategories ?? ['maintenance', 'insurance', 'supplies', 'other'])
  );

  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const val = e.detail.formatted_address || e.detail.name;
    // Update the staged local value so the input stays editable; commit on Save
    if (field === 'start') defaultStartLocal = val;
    if (field === 'end') defaultEndLocal = val;
  }

  let isSaving = $state(false);
  let didSave = $state(false); // tracks whether user clicked Save Defaults
  // When modal opens/closes, keep a copy of persisted settings and reset staged values when closed without saving
  $effect(() => {
    // Guard updates to avoid reading+writing the same state repeatedly
    if (open) {
      if (didSave !== false) didSave = false;

      const persisted = { ...$userSettings } as Partial<UserSettings>;
      const persistedJson = JSON.stringify(persisted);
      const currentJson = JSON.stringify(settings);
      if (persistedJson !== currentJson) {
        settings = persisted;
      }

      // Initialize staged locals from persisted settings only if they differ
      const mpgVal = persisted?.defaultMPG ?? '';
      if (String(defaultMPGLocal) !== String(mpgVal)) defaultMPGLocal = mpgVal;

      const startVal = persisted?.defaultStartAddress || '';
      if (defaultStartLocal !== startVal) defaultStartLocal = startVal;

      const endVal = persisted?.defaultEndAddress || '';
      if (defaultEndLocal !== endVal) defaultEndLocal = endVal;

      const gasVal =
        persisted?.defaultGasPrice != null ? Number(persisted.defaultGasPrice).toFixed(2) : '';
      if (gasDisplay !== gasVal) gasDisplay = gasVal;

      // Respect `initialTab` when opened by a parent wanting the categories view
      if (initialTab && settingsTab !== initialTab) settingsTab = initialTab;
    } else {
      // If the modal is being closed without saving, reset staged changes
      if (!didSave) {
        const persisted = { ...$userSettings } as Partial<UserSettings>;
        const persistedJson = JSON.stringify(persisted);
        const currentJson = JSON.stringify(settings);
        if (persistedJson !== currentJson) settings = persisted;

        const mpgVal = persisted?.defaultMPG ?? '';
        if (String(defaultMPGLocal) !== String(mpgVal)) defaultMPGLocal = mpgVal;

        const startVal = persisted?.defaultStartAddress || '';
        if (defaultStartLocal !== startVal) defaultStartLocal = startVal;

        const endVal = persisted?.defaultEndAddress || '';
        if (defaultEndLocal !== endVal) defaultEndLocal = endVal;

        const gasVal =
          persisted?.defaultGasPrice != null ? Number(persisted.defaultGasPrice).toFixed(2) : '';
        if (gasDisplay !== gasVal) gasDisplay = gasVal;
      }
      // reset flag for next open
      if (didSave !== false) didSave = false;
    }
  });

  async function saveDefaultSettings() {
    if (isSaving) return;
    isSaving = true;

    // Commit staged addresses into settings and parse MPG from the staged local
    settings.defaultStartAddress = defaultStartLocal;
    settings.defaultEndAddress = defaultEndLocal;

    try {
      const mpgParsed = parseFloat(String(defaultMPGLocal).replace(/,/g, '.'));
      settings.defaultMPG = isNaN(mpgParsed) ? 0 : mpgParsed;
    } catch (_e) {
      // ignore parsing errors — defaults will be enforced server-side
    }

    try {
      const parsed = parseFloat(String(gasDisplay).replace(/,/g, '.'));
      const n = isNaN(parsed) ? 0 : parsed;
      settings.defaultGasPrice = n;
    } catch (_e) {
      // ignore parsing errors — defaults will be enforced server-side
    }

    // Persist to the userSettings store and backend (merge to preserve full shape)
    userSettings.set({ ...get(userSettings), ...settings });
    try {
      const result = await saveSettings(settings);
      if (!result.ok) throw new Error(result.error);
      toasts.success('Default values saved!');
      onSuccess?.('Default values saved!');
      // Close modal on success
      didSave = true;
      open = false;
    } catch (_e) {
      toasts.error('Saved locally, but cloud sync failed');
    } finally {
      isSaving = false;
    }
  }

  async function updateCategories(newCategories: string[]) {
    const updateData: Partial<UserSettings> = {};
    if (activeCategoryType === 'maintenance') {
      userSettings.update((s) => ({ ...s, maintenanceCategories: newCategories }));
      updateData.maintenanceCategories = newCategories;
    } else if (activeCategoryType === 'supplies') {
      userSettings.update((s) => ({ ...s, supplyCategories: newCategories }));
      updateData.supplyCategories = newCategories;
    } else {
      userSettings.update((s) => ({ ...s, expenseCategories: newCategories }));
      updateData['expenseCategories'] = newCategories;
    }

    try {
      const result = await saveSettings(updateData);
      if (!result.ok) throw new Error(result.error);
    } catch (_e) {
      toasts.error('Saved locally, but sync failed');
    }
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    const val = newCategoryName.trim().toLowerCase();
    if (activeCategories.includes(val)) {
      toasts.error('Category already exists');
      return;
    }
    const updated = [...activeCategories, val];
    await updateCategories(updated);
    newCategoryName = '';
    toasts.success('Category added');
    onSuccess?.('Category added');
  }

  async function removeCategory(cat: string) {
    if (!confirm(`Delete "${cat}" category?`)) return;
    const updated = activeCategories.filter((c) => c !== cat);
    await updateCategories(updated);
    toasts.success('Category removed');
    onSuccess?.('Category removed');
  }

  /* Gas price display handling: keep a formatted string for UI and sync to settings */
  let gasDisplay: string = $state('');

  $effect(() => {
    if (!settings) return;
    // only update display from settings when not actively editing
    if (
      typeof document !== 'undefined' &&
      document.activeElement &&
      (document.activeElement as HTMLElement).id !== 'default-gas'
    ) {
      const desired =
        settings.defaultGasPrice != null ? Number(settings.defaultGasPrice).toFixed(2) : '';
      if (gasDisplay !== desired) gasDisplay = desired;
    }
  });

  function formatGas() {
    // normalize comma to dot and only update the staged display value.
    const parsed = parseFloat(String(gasDisplay).replace(/,/g, '.'));
    const n = isNaN(parsed) ? 0 : parsed;
    const formatted = n.toFixed(2);
    gasDisplay = formatted;
    // NOTE: do NOT write to `settings.defaultGasPrice` here — only commit on Save.
  }

  function onGasInput(e: Event) {
    // allow only digits, dot, comma
    const el = e.target as HTMLInputElement;
    el.value = el.value.replace(/[^0-9.,]/g, '');
    gasDisplay = el.value;
  }
</script>

<Modal bind:open title="Trip Settings">
  <div class="settings-modal-content">
    <div class="top-tabs">
      <button
        class="top-tab-btn"
        class:active={settingsTab === 'defaults'}
        onclick={() => (settingsTab = 'defaults')}>Default Values</button
      >
      <button
        class="top-tab-btn"
        class:active={settingsTab === 'categories'}
        onclick={() => (settingsTab = 'categories')}>Categories</button
      >
    </div>

    {#if settingsTab === 'defaults'}
      <div class="settings-form space-y-4">
        <p class="text-sm text-gray-500 mb-2">Pre-fill new trips with these values.</p>

        <div class="form-group">
          <label for="default-mpg" class="block text-sm font-medium text-gray-700 mb-1"
            >Default MPG</label
          >
          <input
            id="default-mpg"
            type="number"
            bind:value={defaultMPGLocal}
            placeholder="25"
            min="1"
            step="0.1"
            class="w-full p-2 border rounded-lg"
          />
        </div>

        <div class="form-group">
          <label for="default-gas" class="block text-sm font-medium text-gray-700 mb-1"
            >Default Gas Price</label
          >
          <div class="money-input">
            <span class="money-symbol">$</span>
            <input
              id="default-gas"
              type="text"
              inputmode="decimal"
              bind:value={gasDisplay}
              oninput={onGasInput}
              onblur={formatGas}
              placeholder="0.00"
              aria-label="Default gas price"
              class="money-input-field"
            />
          </div>
        </div>

        <div class="form-group">
          <label for="default-start" class="block text-sm font-medium text-gray-700 mb-1"
            >Default Start Address</label
          >
          <input
            id="default-start"
            type="text"
            bind:value={defaultStartLocal}
            placeholder="Start typing address..."
            autocomplete="off"
            use:autocomplete={{ apiKey: API_KEY }}
            onplace-selected={(e: CustomEvent) => handleAddressSelect('start', e)}
            class="w-full p-2 border rounded-lg"
          />
        </div>

        <div class="form-group">
          <label for="default-end" class="block text-sm font-medium text-gray-700 mb-1"
            >Default End Address</label
          >
          <input
            id="default-end"
            type="text"
            bind:value={defaultEndLocal}
            placeholder="Start typing address..."
            autocomplete="off"
            use:autocomplete={{ apiKey: API_KEY }}
            onplace-selected={(e: CustomEvent) => handleAddressSelect('end', e)}
            class="w-full p-2 border rounded-lg"
          />
        </div>

        <div class="modal-actions pt-4">
          <button
            class="btn-primary w-full save-btn"
            onclick={saveDefaultSettings}
            disabled={isSaving}>{isSaving ? 'Saving…' : 'Save Defaults'}</button
          >
        </div>
      </div>
    {/if}

    {#if settingsTab === 'categories'}
      <div class="categories-manager">
        <div class="tabs sub-tabs">
          <button
            class="tab-btn"
            class:active={activeCategoryType === 'maintenance'}
            onclick={() => (activeCategoryType = 'maintenance')}>Maintenance</button
          >
          <button
            class="tab-btn"
            class:active={activeCategoryType === 'supplies'}
            onclick={() => (activeCategoryType = 'supplies')}>Supplies</button
          >
          <button
            class="tab-btn"
            class:active={activeCategoryType === 'expenses'}
            onclick={() => (activeCategoryType = 'expenses')}>Expenses</button
          >
        </div>

        <p class="text-sm text-gray-500 mb-4">
          Manage {activeCategoryType} options.
        </p>

        <div class="cat-list">
          {#each activeCategories as cat (cat)}
            <div class="cat-item">
              <span class="cat-badge">{cat}</span>
              <button
                class="cat-delete"
                onclick={() => removeCategory(cat)}
                aria-label="Delete Category"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
                  ></line></svg
                >
              </button>
            </div>
          {:else}
            <div class="text-sm text-gray-400 italic text-center py-4">No categories defined.</div>
          {/each}
        </div>

        <div class="add-cat-form">
          <input
            type="text"
            bind:value={newCategoryName}
            placeholder="New category..."
            class="input-field"
            onkeydown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button class="btn-secondary" onclick={addCategory}>Add</button>
        </div>

        <div class="modal-actions mt-6">
          <button class="btn-cancel w-full" onclick={() => (open = false)}>Done</button>
        </div>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .categories-manager {
    padding: 4px;
  }
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
  .sub-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    border-bottom: 1px solid #e5e7eb;
  }
  .tab-btn {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-weight: 600;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s;
  }
  .tab-btn.active {
    color: #ff7f50;
    border-bottom-color: #ff7f50;
  }

  .cat-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
    max-height: 200px;
    overflow-y: auto;
  }
  .cat-item {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #f3f4f6;
    padding: 4px 4px 4px 10px;
    border-radius: 20px;
    border: 1px solid #e5e7eb;
  }
  .cat-badge {
    font-size: 13px;
    font-weight: 500;
    text-transform: capitalize;
    padding: 0 4px;
  }
  .cat-delete {
    border: none;
    background: #e5e7eb;
    color: #6b7280;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .add-cat-form {
    display: flex;
    gap: 8px;
  }
  .add-cat-form .input-field {
    flex: 1;
    padding: 10px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
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

  .settings-form input:focus {
    outline: none;
    border-color: #ff7f50;
    box-shadow: 0 0 0 4px rgba(255, 127, 80, 0.08);
  }

  /* Visual-only $ inside the input field */
  .money-input {
    position: relative;
  }
  /* Adaptive money input: tighter defaults to avoid excessive spacing */
  .money-input {
    position: relative;
    /* anchor the symbol in pixels and compute pad from that + estimated width */
    --money-symbol-offset: 12px; /* pixel anchor */
    --money-symbol-gap: 0.5ch; /* small buffer for symbol width */
    --money-pad: calc(var(--money-symbol-offset) + 1ch + var(--money-symbol-gap));
  }
  @media (min-width: 768px) {
    .money-input {
      --money-symbol-offset: 12px;
      --money-symbol-gap: 0.6ch;
      --money-pad: calc(var(--money-symbol-offset) + 1ch + var(--money-symbol-gap));
    }
  }
  .money-symbol {
    position: absolute;
    left: var(--money-symbol-offset);
    top: 50%;
    transform: translateY(-50%);
    color: #6b7280;
    font-weight: 600;
    pointer-events: none;
    z-index: 2;
    min-width: 1.2ch;
    text-align: left;
  }
  .money-input-field {
    width: 100%;
    /* smaller, balanced minimum padding that keeps the field compact */
    padding: 10px 12px 10px 12px; /* fallback */
    padding-left: max(var(--money-pad), 1.73rem); /* ~10% reduction from previous */
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
    box-sizing: border-box;
    font-size: 16px;
  }
  /* ensure higher-specificity override inside modal */
  .settings-form .money-input .money-input-field {
    padding-left: max(var(--money-pad), 1.73rem);
  }

  /* Slightly reduce the enforced minimum on very small screens */
  @media (max-width: 420px) {
    .money-input-field {
      padding-left: max(var(--money-pad), 1.44rem);
    }
    .money-symbol {
      left: 10px;
    }
  }
  .money-input-field:focus {
    outline: none;
    border-color: #ff7f50;
    box-shadow: 0 0 0 4px rgba(255, 127, 80, 0.08);
  }
  .money-input-field:focus {
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
  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    background: white;
    border: 1px solid #e5e7eb;
    color: #374151;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
    text-decoration: none;
  }
  @media (hover: hover) {
    .btn-secondary:hover {
      background: #f9fafb;
    }
    .cat-delete:hover {
      background: #ef4444;
      color: white;
    }
  }

  /* IMPORTANT: Override Google Maps Autocomplete z-index to appear above the modal */
  :global(.pac-container) {
    z-index: 2147483647 !important;
    /* Positioning is handled by the autocomplete action (fixed vs absolute) */
    pointer-events: auto !important;
  }
</style>
