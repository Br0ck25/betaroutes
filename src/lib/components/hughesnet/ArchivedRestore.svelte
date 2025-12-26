<script lang="ts">
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  let loading = false;
  let orders: Array<any> = [];
  let selected = new Set<string>();
  let error: string | null = null;
  let successMsg: string | null = null;

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/hughesnet/archived');
      const body = await res.json();
      if (body.success) orders = body.orders; else error = body.error || 'Failed to load archived orders';
    } catch (e: any) { error = e.message || 'Network error'; }
    loading = false;
  }

  onMount(load);

  function toggle(id: string) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  }

  function selectAll() {
    if (selected.size === orders.length) selected.clear(); else orders.forEach(o => selected.add(o.id));
  }

  async function restoreSelected() {
    if (selected.size === 0) return;
    loading = true; successMsg = null; error = null;
    try {
      const res = await fetch('/api/hughesnet/archived/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) })
      });
      const body = await res.json();
      if (body.success) {
        successMsg = `Imported ${body.imported.length} orders. ${body.skipped.length} skipped.`;
        // Reload parent UI counts
        dispatch('restored', { imported: body.imported });
        await load();
        selected.clear();
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
        <button class="btn-small" on:click={selectAll}>{selected.size === orders.length ? 'Unselect All' : 'Select All'}</button>
        <button class="btn-primary" disabled={selected.size === 0} on:click={restoreSelected}>Restore Selected</button>
      </div>

      <ul class="list">
        {#each orders as o}
          <li class="item">
            <input type="checkbox" bind:checked={selected.has(o.id)} on:change={() => toggle(o.id)} />
            <div class="meta">
              <div class="addr">{o.order.address || 'No address'}</div>
              <div class="info">ID: {o.id} · Stored: {new Date(o.storedAt).toLocaleString()}</div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
.archive-card { padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; background: white; }
.title { font-weight: 700; margin-bottom: 8px; }
.controls { display:flex; gap:8px; margin-bottom:8px; }
.btn-primary { padding:6px 10px; background:#F97316; color:white; border-radius:8px; }
.btn-small { padding:6px 10px; background:white; border:1px solid #E5E7EB; border-radius:8px }
.list { list-style:none; padding:0; margin:0; max-height:240px; overflow:auto; }
.item { display:flex; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid #F3F4F6; }
.meta { display:flex; flex-direction:column; }
.addr { font-weight:600; }
.info { color:#6B7280; font-size:12px; }
.success { background:#ECFDF5; border:1px solid #BBF7D0; padding:8px; border-radius:8px; margin-bottom:8px }
.error { background:#FEF2F2; border:1px solid #FECACA; padding:8px; border-radius:8px; margin-bottom:8px }
</style>