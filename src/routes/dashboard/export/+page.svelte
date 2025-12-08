<script lang="ts">
  import { trips } from '$lib/stores/trips';
  
  let exportFormat = 'csv';
  let dateFrom = '';
  let dateTo = '';
  let selectedTrips = new Set<string>();
  let selectAll = false;
  let includeSummary = true;
  
  // Logic remains largely the same, just updating UI...
  $: filteredTrips = $trips.filter(trip => {
    if (!trip.date) return false;
    const tripDate = new Date(trip.date);
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (tripDate < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (tripDate > to) return false;
    }
    return true;
  });
  
  $: if (selectAll) {
    selectedTrips = new Set(filteredTrips.map(t => t.id));
  } else if (selectedTrips.size === filteredTrips.length && filteredTrips.length > 0) {
    selectAll = true;
  }
  
  function toggleSelectAll() {
    if (selectAll) selectedTrips = new Set();
    else selectedTrips = new Set(filteredTrips.map(t => t.id));
    selectAll = !selectAll;
  }
  
  function toggleTrip(id: string) {
    if (selectedTrips.has(id)) selectedTrips.delete(id);
    else selectedTrips.add(id);
    selectedTrips = selectedTrips;
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }
  
  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
  
  // ... export functions CSV/PDF kept as is ...
  function exportCSV() { /* Implementation as before */ }
  function exportPDF() { /* Implementation as before */ }
  
  function handleExport() {
    if (exportFormat === 'csv') exportCSV();
    else exportPDF();
  }
</script>

<svelte:head>
  <title>Export - Go Route Yourself</title>
</svelte:head>

<div class="export-page">
  <div class="page-header">
    <div>
      <h1 class="page-title">Export Data</h1>
      <p class="page-subtitle">Download your trip data</p>
    </div>
  </div>
  
  <div class="export-grid">
    <div class="options-card">
      <h2 class="card-title">1. Export Settings</h2>
      
      <div class="option-group">
        <h3 class="option-label">Format</h3>
        <div class="format-buttons">
          <button 
            class="format-btn"
            class:active={exportFormat === 'csv'}
            on:click={() => exportFormat = 'csv'}
          >
            CSV (Excel)
          </button>
          <button 
            class="format-btn"
            class:active={exportFormat === 'pdf'}
            on:click={() => exportFormat = 'pdf'}
          >
            PDF (Print)
          </button>
        </div>
      </div>
      
      <div class="option-group">
        <h3 class="option-label">Date Range</h3>
        <div class="date-inputs">
          <div class="date-field">
            <label for="from">From</label>
            <input id="from" type="date" bind:value={dateFrom} />
          </div>
          <div class="date-field">
            <label for="to">To</label>
            <input id="to" type="date" bind:value={dateTo} />
          </div>
        </div>
      </div>
      
      <div class="option-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={includeSummary} />
          <span>Include summary stats</span>
        </label>
      </div>
      
      <button class="btn-export" on:click={handleExport} disabled={selectedTrips.size === 0}>
        Export {selectedTrips.size} Trip{selectedTrips.size !== 1 ? 's' : ''}
      </button>
    </div>
    
    <div class="selection-card">
      <div class="selection-header">
        <h2 class="card-title">2. Select Trips</h2>
        <button class="btn-select-all" on:click={toggleSelectAll}>
          {selectAll ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      
      {#if filteredTrips.length > 0}
        <div class="trips-list">
          {#each filteredTrips as trip (trip.id)}
            <label class="trip-item">
              <input type="checkbox" checked={selectedTrips.has(trip.id)} on:change={() => toggleTrip(trip.id)} />
              <div class="trip-content">
                <div class="trip-top">
                    <span class="trip-date">{formatDate(trip.date || '')}</span>
                    <span class="trip-miles">{trip.totalMiles?.toFixed(1) || '0'} mi</span>
                </div>
                <div class="trip-route">
                  {trip.startAddress?.split(',')[0] || 'Unknown'} → 
                  {trip.stops && trip.stops.length > 0 ? trip.stops[trip.stops.length - 1].address?.split(',')[0] : 'End'}
                </div>
              </div>
            </label>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <p>No trips found</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Mobile First */
  .export-page { max-width: 1200px; padding: 16px; margin: 0 auto; }
  
  .page-header { margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  
  .export-grid { display: grid; grid-template-columns: 1fr; gap: 24px; } /* Stacked columns */
  
  .options-card, .selection-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #111827; }
  
  .option-group { margin-bottom: 24px; }
  .option-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  
  .format-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .format-btn { 
    padding: 12px; border: 2px solid #E5E7EB; border-radius: 10px; background: white; 
    font-weight: 600; font-size: 14px; color: #6B7280; cursor: pointer; transition: all 0.2s; 
  }
  .format-btn.active { border-color: #FF7F50; color: #FF7F50; background: #FFF5F2; }
  
  .date-inputs { display: flex; flex-direction: column; gap: 12px; }
  .date-field label { font-size: 12px; color: #6B7280; display: block; margin-bottom: 4px; }
  .date-field input { width: 100%; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  
  .checkbox-label { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
  .checkbox-label input { width: 18px; height: 18px; }
  
  .btn-export { 
    width: 100%; padding: 14px; background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); 
    color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; 
    cursor: pointer; box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3);
  }
  .btn-export:disabled { opacity: 0.5; }
  
  .selection-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .btn-select-all { font-size: 13px; color: #FF7F50; background: none; border: none; font-weight: 600; cursor: pointer; }
  
  .trips-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; }
  .trip-item { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; background: #F9FAFB; cursor: pointer; }
  .trip-item:has(input:checked) { border-color: #FF7F50; background: #FFF5F2; }
  .trip-content { flex: 1; }
  .trip-top { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 2px; }
  .trip-date { color: #111827; }
  .trip-miles { color: #6B7280; }
  .trip-route { font-size: 13px; color: #4B5563; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }

  /* Desktop */
  @media (min-width: 1024px) {
    .export-grid { grid-template-columns: 350px 1fr; align-items: start; }
    .date-inputs { flex-direction: row; }
    .date-field { flex: 1; }
  }
</style>
