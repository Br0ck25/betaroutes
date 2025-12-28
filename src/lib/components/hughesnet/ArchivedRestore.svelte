<script lang="ts">
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let loading = false;
  let orders: Array<any> = [];
  let selected: string[] = [];
  let error: string | null = null;
  let successMsg: string | null = null;

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/hughesnet/archived');
      const body: any = await res.json();
      if (body.success) orders = body.orders; else error = body.error || 'Failed to load archived orders';
    } catch (e: any) { error = e.message || 'Network error'; }
    loading = false;
  }

  onMount(load);

  function toggle(id: string) {
    console.log('[ArchivedRestore] toggle', id);
    const idx = selected.indexOf(id);
    if (idx >= 0) {
      selected = [...selected.slice(0, idx), ...selected.slice(idx + 1)];
    } else {
      selected = [...selected, id];
    }
  }

  function selectAll() {
    console.log('[ArchivedRestore] selectAll before:', selected.length, 'orders:', orders.length);
    if (selected.length === orders.length) selected = [];
    else selected = orders.map(o => o.id);
    console.log('[ArchivedRestore] selectAll after:', selected.length);
  }

  // Modal control
  let showConfirm = false;
  let confirmAction: 'restore' | 'restore_sync' = 'restore';

  function openConfirm() {
    showConfirm = true;
    confirmAction = 'restore';
  }

  function closeConfirm() { showConfirm = false; }

  async function confirmRestore() {
    if (selected.length === 0) { closeConfirm(); return; }
    loading = true; successMsg = null; error = null;
    try {
      const res = await fetch('/api/hughesnet/archived/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      const body: any = await res.json();
      if (body.success) {
        successMsg = `Imported ${body.imported.length} orders. ${body.skipped.length} skipped.`;
        // Notify parent about imported ids and dates
        dispatch('restored', { imported: body.imported, importedDates: body.importedDates || [] });
        if (confirmAction === 'restore_sync' && body.importedDates && body.importedDates.length > 0) {
          dispatch('restoreAndSync', { dates: body.importedDates });
        }
        await load();
        selected = [];
        closeConfirm();
      } else {
        error = body.error || 'Import failed';
      }
    } catch (e: any) { error = e.message || 'Network error'; }
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
        <button type="button" class="btn-small" on:click={selectAll}>{selected.length === orders.length ? 'Unselect All' : 'Select All'}</button>
        <button type="button" class="btn-primary" disabled={selected.length === 0} on:click={openConfirm}>Restore Selected</button>
      </div>

      <ul class="list">
        {#each orders as o}
          <li class="item">
            <input type="checkbox" checked={selected.includes(o.id)} on:change={() => toggle(o.id)} aria-label={`Select order ${o.id}`} />
            <div class="meta">
              <div class="addr">{o.order.address || 'No address'}</div>
              <div class="info">ID: {o.id} · Stored: {new Date(o.storedAt).toLocaleString()}</div>
            </div>
          </li>
        {/each}
      </ul>

      {#if showConfirm}
        <div class="modal-overlay">
          <div class="modal">
            <h4>Restore {selected.length} archived order(s)?</h4>
            <p>Would you like to just restore them, or restore and run a HughesNet sync now to create trips for those dates?</p>
            <div class="modal-actions">
              <button class="btn-secondary" on:click={() => { confirmAction = 'restore'; confirmRestore(); }}>Restore Only</button>
              <button class="btn-primary" on:click={() => { confirmAction = 'restore_sync'; confirmRestore(); }}>Restore & Sync Now</button>
              <button class="btn-small" on:click={closeConfirm}>Cancel</button>
            </div>
            {#if confirmAction === 'restore_sync'}
              <p class="help">⚠️ Restoring and syncing will create trips for the imported dates and may overwrite existing trips for those dates.</p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
.archive-card { padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; background: white; }
.title { font-weight: 700; margin-bottom: 8px; }
.controls { display:flex; gap:8px; margin-bottom:8px; }
.controls button { pointer-events: auto; }
.btn-primary { padding:6px 10px; background:#F97316; color:white; border-radius:8px; }
.btn-small { padding:6px 10px; background:white; border:1px solid #E5E7EB; border-radius:8px }
.list { list-style:none; padding:0; margin:0; max-height:240px; overflow:auto; }
.item { display:flex; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid #F3F4F6; }
.meta { display:flex; flex-direction:column; }
.addr { font-weight:600; }
.info { color:#6B7280; font-size:12px; }
.success { background:#ECFDF5; border:1px solid #BBF7D0; padding:8px; border-radius:8px; margin-bottom:8px }
.error { background:#FEF2F2; border:1px solid #FECACA; padding:8px; border-radius:8px; margin-bottom:8px }
  .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:50; }
  .modal { background: white; padding: 20px; border-radius: 10px; max-width: 480px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
  .modal h4 { margin-top:0; }
  .modal-actions { display:flex; gap:8px; margin-top:12px; }
  .help { margin-top:8px; color:#92400E; font-size:13px; }
</style>