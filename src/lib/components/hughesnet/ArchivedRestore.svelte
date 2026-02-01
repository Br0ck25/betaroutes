<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { csrfFetch } from '$lib/utils/csrf';

  // Callbacks (replace createEventDispatcher with callback props)
  // eslint-disable-next-line prefer-const
  let { onRestored, onRestoreAndSync } = $props<{
    onRestored?: (payload: { imported: string[]; importedDates: string[] }) => void;
    onRestoreAndSync?: (payload: { dates: string[] }) => void;
  }>();

  let loading = $state(false);
  type ArchivedOrder = {
    id: string;
    order?: { address?: string; confirmScheduleDate?: string };
    storedAt?: string;
  };
  let orders: ArchivedOrder[] = $state([]);
  let selected: string[] = $state([]);
  let error: string | null = $state(null);
  let successMsg: string | null = $state(null);

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/hughesnet/archived');
      const body = (await res.json()) as {
        success?: boolean;
        orders?: ArchivedOrder[];
        error?: string;
      };
      if (body.success) orders = body.orders ?? [];
      else error = body.error || 'Failed to load archived orders';
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e || 'Network error');
    }
    loading = false;
  }

  $effect(() => {
    // Run client-only loader once on mount
    void load();
  });

  function toggle(id: string) {
    // Toggle selection for an archived order
    const idx = selected.indexOf(id);
    if (idx >= 0) {
      selected = [...selected.slice(0, idx), ...selected.slice(idx + 1)];
    } else {
      selected = [...selected, id];
    }
  }

  function selectAll() {
    // Select or unselect all archived orders
    if (selected.length === orders.length) selected = [];
    else selected = orders.map((o) => o.id);
  }

  // Modal control
  let showConfirm = $state(false);
  let confirmAction: 'restore' | 'restore_sync' = $state('restore');

  function openConfirm() {
    showConfirm = true;
    confirmAction = 'restore';
  }

  function closeConfirm() {
    showConfirm = false;
  }

  async function confirmRestore() {
    if (selected.length === 0) {
      closeConfirm();
      return;
    }
    loading = true;
    successMsg = null;
    error = null;
    try {
      const res = await csrfFetch('/api/hughesnet/archived/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      const body = (await res.json()) as {
        success?: boolean;
        imported?: string[];
        skipped?: string[];
        importedDates?: string[];
        error?: string;
      };
      if (body.success) {
        successMsg = `Imported ${body.imported?.length ?? 0} orders. ${body.skipped?.length ?? 0} skipped.`;
        // Notify parent via callback props
        onRestored?.({ imported: body.imported ?? [], importedDates: body.importedDates ?? [] });
        if (
          confirmAction === 'restore_sync' &&
          body.importedDates &&
          body.importedDates.length > 0
        ) {
          onRestoreAndSync?.({ dates: body.importedDates });
        }
        await load();
        selected = [];
        closeConfirm();
      } else {
        error = body.error || 'Import failed';
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e || 'Network error');
    }
    loading = false;
  }
</script>

<div class="archive-card">
  <h3 class="title">Archived Orders</h3>
  {#if loading}
    <p>Loading...</p>
  {:else}
    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if successMsg}
      <div class="success">{successMsg}</div>
    {/if}

    {#if orders.length === 0}
      <p>No archived orders found.</p>
    {:else}
      <div class="controls">
        <button type="button" class="btn-small" onclick={selectAll}
          >{selected.length === orders.length ? 'Unselect All' : 'Select All'}</button
        >
        <button
          type="button"
          class="btn-primary"
          disabled={selected.length === 0}
          onclick={openConfirm}>Restore Selected</button
        >
      </div>

      <ul class="list">
        {#each orders as o (o.id)}
          <li class="item">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onchange={() => toggle(o.id)}
              aria-label={`Select order ${o.id}`}
            />
            <div class="meta">
              <div class="addr">{o.order?.address ?? 'No address'}</div>
              <div class="info">
                ID: {o.id}
                {#if o.order?.confirmScheduleDate}
                  · Order Date: {o.order?.confirmScheduleDate}
                {/if}
                · Stored: {o.storedAt ? new Date(o.storedAt).toLocaleString() : 'Unknown'}
              </div>
            </div>
          </li>
        {/each}
      </ul>

      {#if showConfirm}
        <Modal bind:open={showConfirm} title={`Restore ${selected.length} archived order(s)?`}>
          <div class="space-y-3">
            <p>
              Would you like to just restore them, or restore and run a HughesNet sync now to create
              trips for those dates?
            </p>
            <div class="modal-actions">
              <Button
                variant="outline"
                action={() => {
                  confirmAction = 'restore';
                  void confirmRestore();
                }}>Restore Only</Button
              >
              <Button
                variant="primary"
                action={() => {
                  confirmAction = 'restore_sync';
                  void confirmRestore();
                }}>Restore & Sync Now</Button
              >
              <Button variant="secondary" action={closeConfirm}>Cancel</Button>
            </div>
            {#if confirmAction === 'restore_sync'}
              <p class="help">
                ⚠️ Restoring and syncing will create trips for the imported dates and may overwrite
                existing trips for those dates.
              </p>
            {/if}
          </div>
        </Modal>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .archive-card {
    padding: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    background: white;
  }
  .title {
    font-weight: 700;
    margin-bottom: 8px;
  }
  .controls {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .controls button {
    pointer-events: auto;
  }
  .btn-primary {
    padding: 6px 10px;
    background: #f97316;
    color: white;
    border-radius: 8px;
  }
  .btn-small {
    padding: 6px 10px;
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 240px;
    overflow: auto;
  }
  .item {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #f3f4f6;
  }
  .meta {
    display: flex;
    flex-direction: column;
  }
  .addr {
    font-weight: 600;
  }
  .info {
    color: #6b7280;
    font-size: 12px;
  }
  .success {
    background: #ecfdf5;
    border: 1px solid #bbf7d0;
    padding: 8px;
    border-radius: 8px;
    margin-bottom: 8px;
  }
  .error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    padding: 8px;
    border-radius: 8px;
    margin-bottom: 8px;
  }

  .help {
    margin-top: 8px;
    color: #92400e;
    font-size: 13px;
  }
</style>
