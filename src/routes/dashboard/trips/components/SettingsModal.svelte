<script lang="ts">
    import Modal from '$lib/components/ui/Modal.svelte';
    import { userSettings } from '$lib/stores/userSettings';
    import { toasts } from '$lib/stores/toast';
    import { autocomplete } from '$lib/utils/autocomplete';

    export let open = false;
    export let API_KEY: string;

    let settingsTab: 'defaults' | 'categories' = 'defaults';
    let activeCategoryType: 'maintenance' | 'supplies' = 'maintenance';
    let newCategoryName = '';
    let settings = { ...$userSettings };

    $: if ($userSettings) { settings = { ...$userSettings }; }
    $: activeCategories = activeCategoryType === 'maintenance' 
      ? ($userSettings.maintenanceCategories || ['oil change', 'repair'])
      : ($userSettings.supplyCategories || ['water', 'snacks']);

    function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
        const val = e.detail.formatted_address || e.detail.name;
        if (field === 'start') settings.defaultStartAddress = val;
        if (field === 'end') settings.defaultEndAddress = val;
    }

    let isSaving = false;

    async function saveDefaultSettings() {
        if (isSaving) return;
        console.debug && console.debug('[settings] saveDefaultSettings', settings);
        isSaving = true;
        userSettings.set(settings);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: settings })
            });
            if (!res.ok) throw new Error('Failed to sync');
            toasts.success('Default values saved!');
            // Close modal on success
            open = false;
        } catch (e) {
            console.error('Sync error:', e);
            toasts.error('Saved locally, but cloud sync failed');
        } finally {
            isSaving = false;
        }
    }

    async function updateCategories(newCategories: string[]) {
        const updateData: any = {};
        if (activeCategoryType === 'maintenance') {
            userSettings.update(s => ({ ...s, maintenanceCategories: newCategories }));
            updateData.maintenanceCategories = newCategories;
        } else {
            userSettings.update(s => ({ ...s, supplyCategories: newCategories }));
            updateData.supplyCategories = newCategories;
        }

        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });
        } catch (e) {
            console.error('Failed to sync settings', e);
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
    }

    async function removeCategory(cat: string) {
        if (!confirm(`Delete "${cat}" category?`)) return;
        const updated = activeCategories.filter(c => c !== cat);
        await updateCategories(updated);
        toasts.success('Category removed');
    }
</script>

<Modal bind:open title="Trip Settings">
    <div class="settings-modal-content">
        <div class="top-tabs">
            <button class="top-tab-btn" class:active={settingsTab === 'defaults'} onclick={() => settingsTab = 'defaults'}>Default Values</button>
            <button class="top-tab-btn" class:active={settingsTab === 'categories'} onclick={() => settingsTab = 'categories'}>Categories</button>
        </div>

        {#if settingsTab === 'defaults'}
            <div class="settings-form space-y-4">
                <p class="text-sm text-gray-500 mb-2">Pre-fill new trips with these values.</p>
                
                <div class="form-group">
                   <label for="default-mpg" class="block text-sm font-medium text-gray-700 mb-1">Default MPG</label>
                    <input id="default-mpg" type="number" bind:value={settings.defaultMPG} placeholder="25" min="1" step="0.1" class="w-full p-2 border rounded-lg" />
                </div>
                
                <div class="form-group">
                    <label for="default-gas" class="block text-sm font-medium text-gray-700 mb-1">Default Gas Price</label>
                    <div class="relative">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input id="default-gas" type="number" bind:value={settings.defaultGasPrice} placeholder="3.50" min="0" step="0.01" class="w-full p-2 pl-7 border rounded-lg" />
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="default-start" class="block text-sm font-medium text-gray-700 mb-1">Default Start Address</label>
                    <input 
                        id="default-start"
                        type="text" 
                        bind:value={settings.defaultStartAddress}
                        placeholder="Start typing address..."
                        autocomplete="off"
                        use:autocomplete={{ apiKey: API_KEY }}
                        onplace-selected={(e) => handleAddressSelect('start', e)}
                        class="w-full p-2 border rounded-lg"
                    />
                </div>
                
                <div class="form-group">
                      <label for="default-end" class="block text-sm font-medium text-gray-700 mb-1">Default End Address</label>
                    <input 
                        id="default-end"
                        type="text" 
                        bind:value={settings.defaultEndAddress}
                        placeholder="Start typing address..."
                        autocomplete="off"
                        use:autocomplete={{ apiKey: API_KEY }}
                        onplace-selected={(e) => handleAddressSelect('end', e)}
                        class="w-full p-2 border rounded-lg"
                    />
                </div>
                
                 <div class="modal-actions pt-4">
                    <button class="btn-primary w-full" onclick={saveDefaultSettings} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save Defaults'}</button>
                </div>
            </div>
        {/if}

        {#if settingsTab === 'categories'}
            <div class="categories-manager">
                <div class="tabs sub-tabs">
                    <button class="tab-btn" class:active={activeCategoryType === 'maintenance'} onclick={() => activeCategoryType = 'maintenance'}>Maintenance</button>
                    <button class="tab-btn" class:active={activeCategoryType === 'supplies'} onclick={() => activeCategoryType = 'supplies'}>Supplies</button>
                </div>

                <p class="text-sm text-gray-500 mb-4">
                   Manage {activeCategoryType} options.
                </p>
                
                <div class="cat-list">
                    {#each activeCategories as cat}
                        <div class="cat-item">
                             <span class="cat-badge">{cat}</span>
                            <button class="cat-delete" onclick={() => removeCategory(cat)} aria-label="Delete Category">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    {:else}
                        <div class="text-sm text-gray-400 italic text-center py-4">No categories defined.</div>
                    {/each}
                </div>

                <div class="add-cat-form">
                    <input type="text" bind:value={newCategoryName} placeholder="New category..." class="input-field" onkeydown={(e) => e.key === 'Enter' && addCategory()} />
                    <button class="btn-secondary" onclick={addCategory}>Add</button>
                </div>
                
                <div class="modal-actions mt-6">
                    <button class="btn-cancel w-full" onclick={() => open = false}>Done</button>
                </div>
            </div>
        {/if}
    </div>
</Modal>

<style>
  .categories-manager { padding: 4px; }
  .top-tabs { display: flex; border-bottom: 2px solid #E5E7EB; margin-bottom: 20px; }
  .top-tab-btn { flex: 1; padding: 12px; font-weight: 600; color: #6B7280; border: none; background: none; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
  .top-tab-btn.active { color: #FF7F50; border-bottom-color: #FF7F50; }
  .sub-tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #E5E7EB; }
  .tab-btn { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; font-weight: 600; color: #6B7280; cursor: pointer; transition: all 0.2s; }
  .tab-btn.active { color: #FF7F50; border-bottom-color: #FF7F50; }
  
  .cat-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; }
  .cat-item { display: flex; align-items: center; gap: 4px; background: #F3F4F6; padding: 4px 4px 4px 10px; border-radius: 20px; border: 1px solid #E5E7EB; }
  .cat-badge { font-size: 13px; font-weight: 500; text-transform: capitalize; padding: 0 4px; }
  .cat-delete { border: none; background: #E5E7EB; color: #6B7280; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
  
  .add-cat-form { display: flex; gap: 8px; }
  .add-cat-form .input-field { flex: 1; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  .modal-actions .btn-cancel { background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; }

  .settings-form input:focus { outline: none; border-color: #FF7F50; ring: 2px solid rgba(255, 127, 80, 0.1); }
  
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); transition: transform 0.1s; cursor: pointer; }
  .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px; background: white; border: 1px solid #E5E7EB; color: #374151; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; text-decoration: none; }
  @media (hover: hover) {
    .btn-secondary:hover { background: #F9FAFB; }
    .cat-delete:hover { background: #EF4444; color: white; }
  }

  /* IMPORTANT: Override Google Maps Autocomplete z-index to appear above the modal */
  :global(.pac-container) {
    z-index: 2147483647 !important;
    /* Positioning is handled by the autocomplete action (fixed vs absolute) */
    pointer-events: auto !important;
  }
</style>