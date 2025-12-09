<script lang="ts">
  import { trips } from '$lib/stores/trips';
  
  let exportFormat = 'csv';
  let dateFrom = '';
  let dateTo = '';
  let selectedTrips = new Set<string>();
  let selectAll = false;

  // Reactive filter logic
  $: filteredTrips = $trips.filter(trip => {
    if (!trip.date) return false;
    const tripDate = new Date(trip.date);
    if (dateFrom && tripDate < new Date(dateFrom)) return false;
    if (dateTo && tripDate > new Date(dateTo)) return false;
    return true;
  });

  // Reactive selection logic
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

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
  
  // --- NEW: EXPORT LOGIC STARTS HERE ---

  function handleExport() {
    // 1. Get the actual trip objects based on the selected IDs
    const tripsToExport = filteredTrips.filter(t => selectedTrips.has(t.id));

    if (tripsToExport.length === 0) {
      alert("No trips selected to export.");
      return;
    }

    if (exportFormat === 'csv') {
      generateCSV(tripsToExport);
    } else {
      alert("PDF export requires a library like 'jspdf'. Please install it to enable PDF support.");
    }
  }

  function generateCSV(data: any[]) {
    // 2. Define headers matching your data structure
    const headers = ['Date', 'Miles', 'Start Address', 'End Address', 'Purpose', 'Vehicle'];
    
    // 3. Map trips to CSV rows
    const rows = data.map(trip => {
      const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';
      const miles = trip.totalMiles || 0;
      
      // Escape commas in addresses to prevent breaking CSV format
      const start = `"${(trip.startAddress || '').replace(/"/g, '""')}"`; 
      const end = trip.stops && trip.stops.length > 0
        ? `"${(trip.stops[trip.stops.length - 1].address || '').replace(/"/g, '""')}"` 
        : '"End"';
      
      const purpose = `"${(trip.purpose || '').replace(/"/g, '""')}"`;
      const vehicle = `"${(trip.vehicleId || '').replace(/"/g, '""')}"`;

      return [date, miles, start, end, purpose, vehicle].join(',');
    });

    // 4. Combine headers and rows
    const csvContent = [headers.join(','), ...rows].join('\n');

    // 5. Create a download link programmatically
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trips_export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
</script>

<div class="export-grid">
  <div class="options-card">
    <h2 class="card-title">1. Export Settings</h2>
    
    <div class="option-group">
      <h3 class="option-label">Format</h3>
      <div class="format-buttons">
        <button class="format-btn" class:active={exportFormat === 'csv'} on:click={() => exportFormat = 'csv'}>CSV (Excel)</button>
        <button class="format-btn" class:active={exportFormat === 'pdf'} on:click={() => exportFormat = 'pdf'}>PDF (Print)</button>
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
    
    <button class="btn-action" on:click={handleExport} disabled={selectedTrips.size === 0}>
      Export {selectedTrips.size} Trip{selectedTrips.size !== 1 ? 's' : ''}
    </button>
  </div>
  
  <div class="selection-card">
    <div class="selection-header">
      <h2 class="card-title">2. Select Trips</h2>
      <button class="btn-text" on:click={toggleSelectAll}>{selectAll ? 'Deselect All' : 'Select All'}</button>
    </div>
    
    {#if filteredTrips.length > 0}
      <div class="trips-list">
        {#each filteredTrips as trip (trip.id)}
          <label class="trip-item" class:selected={selectedTrips.has(trip.id)}>
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
      <div class="empty-state">No trips found</div>
    {/if}
  </div>
</div>

<style>
  /* Reuse styles from your Export page */
  .export-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
  .options-card, .selection-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #111827; }
  .option-group { margin-bottom: 24px; }
  .option-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  .format-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .format-btn { padding: 12px; border: 2px solid #E5E7EB; border-radius: 10px; background: white; font-weight: 600; font-size: 14px; color: #6B7280; cursor: pointer; }
  .format-btn.active { border-color: #FF7F50; color: #FF7F50; background: #FFF5F2; }
  .date-inputs { display: flex; gap: 12px; }
  .date-field { flex: 1; }
  .date-field input { width: 100%; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  .btn-action { width: 100%; padding: 14px; background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; }
  .btn-action:disabled { opacity: 0.5; }
  .selection-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .btn-text { color: #FF7F50; background: none; border: none; font-weight: 600; cursor: pointer; }
  .trips-list { display: flex; flex-direction: column; gap: 8px; max-height: 400px; overflow-y: auto; }
  .trip-item { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; background: #F9FAFB; cursor: pointer; }
  .trip-item.selected { border-color: #FF7F50; background: #FFF5F2; }
  .trip-content { flex: 1; }
  .trip-top { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; }
  .empty-state { text-align: center; color: #9CA3AF; padding: 20px; }

  @media (min-width: 1024px) {
    .export-grid { grid-template-columns: 350px 1fr; align-items: start; }
  }
</style>