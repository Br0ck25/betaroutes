<script lang="ts">
  import { trips } from '$lib/stores/trips';
  
  let exportFormat = 'csv';
  let dateFrom = '';
  let dateTo = '';
  let selectedTrips = new Set<string>();
  let selectAll = false;
  let includeSummary = true;
  
  // Filter trips by date
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
  } else if (selectedTrips.size === filteredTrips.length) {
    selectAll = true;
  }
  
  function toggleSelectAll() {
    if (selectAll) {
      selectedTrips = new Set();
    } else {
      selectedTrips = new Set(filteredTrips.map(t => t.id));
    }
    selectAll = !selectAll;
  }
  
  function toggleTrip(id: string) {
    if (selectedTrips.has(id)) {
      selectedTrips.delete(id);
      selectedTrips = selectedTrips;
    } else {
      selectedTrips.add(id);
      selectedTrips = selectedTrips;
    }
  }
  
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  }
  
  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
  
  function exportCSV() {
    const tripsToExport = filteredTrips.filter(t => selectedTrips.has(t.id));
    if (tripsToExport.length === 0) {
      alert('Please select at least one trip to export');
      return;
    }
    
    let csv = 'Date,Start Time,End Time,Start Address,Stops,Miles,Earnings,Fuel Cost,Maintenance,Supplies,Total Costs,Net Profit,Notes\n';
    let totalMiles = 0;
    let totalEarnings = 0;
    let totalFuel = 0;
    let totalMaintenance = 0;
    let totalSupplies = 0;
    let totalProfit = 0;
    
    tripsToExport.forEach(trip => {
      const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
      const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
      const profit = earnings - costs;
      
      totalMiles += trip.totalMiles || 0;
      totalEarnings += earnings;
      totalFuel += trip.fuelCost || 0;
      totalMaintenance += trip.maintenanceCost || 0;
      totalSupplies += trip.suppliesCost || 0;
      totalProfit += profit;
      
      const row = [
        formatDate(trip.date || ''),
        trip.startTime || '',
        trip.endTime || '',
        `"${trip.startAddress || ''}"`,
        trip.stops?.length || 0,
        trip.totalMiles?.toFixed(2) || '0.00',
        earnings.toFixed(2),
        (trip.fuelCost || 0).toFixed(2),
        (trip.maintenanceCost || 0).toFixed(2),
        (trip.suppliesCost || 0).toFixed(2),
        costs.toFixed(2),
        profit.toFixed(2),
        `"${trip.notes || ''}"`
      ];
      csv += row.join(',') + '\n';
    });
    
    if (includeSummary) {
      csv += '\n';
      csv += 'SUMMARY\n';
      csv += `Total Trips,${tripsToExport.length}\n`;
      csv += `Total Miles,${totalMiles.toFixed(2)}\n`;
      csv += `Total Earnings,${totalEarnings.toFixed(2)}\n`;
      csv += `Total Fuel Cost,${totalFuel.toFixed(2)}\n`;
      csv += `Total Maintenance,${totalMaintenance.toFixed(2)}\n`;
      csv += `Total Supplies,${totalSupplies.toFixed(2)}\n`;
      csv += `Total Costs,${(totalFuel + totalMaintenance + totalSupplies).toFixed(2)}\n`;
      csv += `Net Profit,${totalProfit.toFixed(2)}\n`;
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trips-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function exportPDF() {
    const tripsToExport = filteredTrips.filter(t => selectedTrips.has(t.id));
    if (tripsToExport.length === 0) {
      alert('Please select at least one trip to export');
      return;
    }
    
    let totalMiles = 0;
    let totalEarnings = 0;
    let totalCosts = 0;
    let totalProfit = 0;
    
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Trip Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 40px;
      color: #111827;
    }
    .header {
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 3px solid #FF7F50;
    }
    h1 { font-size: 32px; margin-bottom: 8px; color: #111827; }
    .date-range { font-size: 14px; color: #6B7280; }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 40px;
      padding: 20px;
      background: #F9FAFB;
      border-radius: 8px;
    }
    .summary-item { text-align: center; }
    .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
    .summary-value { font-size: 24px; font-weight: 700; color: #111827; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 40px;
    }
    th {
      background: #F3F4F6;
      padding: 12px;
      text-align: left;
      font-size: 12px;
      font-weight: 700;
      color: #6B7280;
      text-transform: uppercase;
      border-bottom: 2px solid #E5E7EB;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #E5E7EB;
      font-size: 14px;
    }
    .profit { font-weight: 700; }
    .profit.positive { color: #16A34A; }
    .profit.negative { color: #DC2626; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      color: #9CA3AF;
      font-size: 12px;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Trip Report</h1>
    <p class="date-range">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
    ${dateFrom || dateTo ? `<p class="date-range">Period: ${dateFrom || 'Start'} to ${dateTo || 'Present'}</p>` : ''}
  </div>
`;
    if (includeSummary) {
      tripsToExport.forEach(trip => {
        const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
        const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
        const profit = earnings - costs;
        
        totalMiles += trip.totalMiles || 0;
        totalEarnings += earnings;
        totalCosts += costs;
        totalProfit += profit;
      });
      html += `
  <div class="summary">
    <div class="summary-item">
      <div class="summary-label">Total Trips</div>
      <div class="summary-value">${tripsToExport.length}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Total Miles</div>
      <div class="summary-value">${totalMiles.toFixed(1)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Total Earnings</div>
      <div class="summary-value">${formatCurrency(totalEarnings)}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Net Profit</div>
      <div class="summary-value" style="color: ${totalProfit >= 0 ? '#16A34A' : '#DC2626'}">${formatCurrency(totalProfit)}</div>
    </div>
  </div>
`;
    }
    
    html += `
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Route</th>
        <th>Miles</th>
        <th>Earnings</th>
        <th>Costs</th>
        <th>Profit</th>
      </tr>
    </thead>
    <tbody>
`;
    tripsToExport.forEach(trip => {
      const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
      const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
      const profit = earnings - costs;
      
      const destination = trip.stops && trip.stops.length > 0 
        ? trip.stops[trip.stops.length - 1].address?.split(',')[0] 
        : 'Multiple stops';
      
      html += `
      <tr>
        <td>${formatDate(trip.date || '')}</td>
        <td>${trip.startAddress?.split(',')[0] || 'Unknown'} → ${destination}</td>
        <td>${trip.totalMiles?.toFixed(1) || '0.0'} mi</td>
        <td>${formatCurrency(earnings)}</td>
        <td>${formatCurrency(costs)}</td>
        <td class="profit ${profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(profit)}</td>
      </tr>
`;
    });
    html += `
    </tbody>
  </table>
  
  <div class="footer">
    <p>Generated by Go Route Yourself - Professional Route Planning & Profit Tracking</p>
  </div>
</body>
</html>
`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }
  
  function handleExport() {
    if (exportFormat === 'csv') {
      exportCSV();
    } else {
      exportPDF();
    }
  }
</script>

<svelte:head>
  <title>Export - Go Route Yourself</title>
</svelte:head>

<div class="export-page">
  <div class="page-header">
    <div>
      <h1 class="page-title">Export Data</h1>
      <p class="page-subtitle">Download your trip data for records or analysis</p>
    </div>
  </div>
  
  <div class="export-grid">
    <div class="options-card">
      <h2 class="card-title">Export Options</h2>
      
      <div class="option-group">
        <h3 class="option-label">Format</h3>
        <div class="format-buttons">
          <button 
            class="format-btn"
            class:active={exportFormat === 'csv'}
            on:click={() => exportFormat = 'csv'}
            aria-label="Select CSV Format"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div>
              <div class="format-name">CSV</div>
              <div class="format-desc">Spreadsheet format</div>
            </div>
          </button>
          
          <button 
            class="format-btn"
            class:active={exportFormat === 'pdf'}
            on:click={() => exportFormat = 'pdf'}
            aria-label="Select PDF Format"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div>
              <div class="format-name">PDF</div>
              <div class="format-desc">Print-ready report</div>
            </div>
          </button>
        </div>
      </div>
      
      <div class="option-group">
        <h3 class="option-label">Date Range (optional)</h3>
        <div class="date-inputs">
          <input id="date-from" type="date" bind:value={dateFrom} aria-label="Start Date" />
          <span class="date-separator">to</span>
          <input id="date-to" type="date" bind:value={dateTo} aria-label="End Date" />
        </div>
      </div>
      
      <div class="option-group">
        <label class="checkbox-label" for="include-summary">
          <input id="include-summary" type="checkbox" bind:checked={includeSummary} />
          <span>Include summary statistics</span>
        </label>
      </div>
      
      <button class="btn-export" on:click={handleExport} disabled={selectedTrips.size === 0}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M16 11V15C16 15.5304 15.7893 16.0391 15.4142 16.4142C15.0391 16.7893 14.5304 17 14 17H4C3.46957 17 2.96086 16.7893 2.58579 16.4142C2.21071 16.0391 2 15.5304 2 15V11M5 7L9 3M9 3L13 7M9 3V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Export {selectedTrips.size} Trip{selectedTrips.size !== 1 ? 's' : ''}
      </button>
    </div>
    
    <div class="selection-card">
      <div class="selection-header">
        <h2 class="card-title">Select Trips</h2>
        <button class="btn-select-all" on:click={toggleSelectAll}>
          {selectAll ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      
      {#if filteredTrips.length > 0}
        <div class="trips-list">
          {#each filteredTrips as trip (trip.id)}
            {@const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0}
            {@const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0)}
            {@const profit = earnings - costs}
            
            <label class="trip-checkbox" for="trip-{trip.id}">
              <input 
                id="trip-{trip.id}"
                type="checkbox" 
                checked={selectedTrips.has(trip.id)}
                on:change={() => toggleTrip(trip.id)}
              />
              <div class="trip-info">
                <div class="trip-header">
                  <span class="trip-date">{formatDate(trip.date || '')}</span>
                  <span class="trip-profit" class:positive={profit >= 0} class:negative={profit < 0}>
                    {formatCurrency(profit)}
                  </span>
                </div>
                <div class="trip-route">
                  {trip.startAddress?.split(',')[0] || 'Unknown'} 
                  → 
                  {trip.stops && trip.stops.length > 0 
                    ? trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Multiple'
                    : 'No stops'}
                </div>
                <div class="trip-meta">
                  {trip.totalMiles?.toFixed(1) || '0.0'} mi
                  {#if trip.stops && trip.stops.length > 0}
                    • {trip.stops.length} stops
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>
      {:else}
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <path d="M40 18L24 4L8 18V38C8 38.5304 8.21071 39.0391 8.58579 39.4142C8.96086 39.7893 9.46957 40 10 40H38C38.5304 40 39.0391 39.7893 39.4142 39.4142C39.7893 39.0391 40 38.5304 40 38V18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p>No trips found in selected date range</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .export-page { max-width: 1200px; }
  .page-header { margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .export-grid { display: grid; grid-template-columns: 400px 1fr; gap: 24px; }
  
  .options-card, .selection-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 24px; }
  .card-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 24px; }
  
  .option-group { margin-bottom: 24px; }
  .option-label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; }
  
  .format-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .format-btn { display: flex; align-items: center; gap: 12px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; transition: all 0.2s; text-align: left; font-family: inherit; }
  .format-btn:hover { border-color: var(--orange); background: white; }
  .format-btn.active { border-color: var(--orange); background: rgba(255, 127, 80, 0.05); }
  .format-btn svg { color: #6B7280; flex-shrink: 0; }
  .format-btn.active svg { color: var(--orange); }
  .format-name { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .format-desc { font-size: 12px; color: #6B7280; }
  
  .date-inputs { display: flex; align-items: center; gap: 12px; }
  .date-inputs input { flex: 1; padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 14px; font-family: inherit; }
  .date-inputs input:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  .date-separator { font-size: 14px; color: #6B7280; }
  
  .checkbox-label { display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; color: #374151; }
  .checkbox-label input[type="checkbox"] { width: 20px; height: 20px; cursor: pointer; }
  
  .btn-export { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; border-radius: 12px; font-weight: 600; font-size: 15px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-export:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
  .btn-export:disabled { opacity: 0.5; cursor: not-allowed; }
  
  .selection-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .btn-select-all { padding: 8px 16px; background: white; color: var(--orange); border: 2px solid var(--orange); border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-select-all:hover { background: var(--orange); color: white; }
  
  .trips-list { display: flex; flex-direction: column; gap: 12px; max-height: 600px; overflow-y: auto; padding-right: 8px; }
  .trip-checkbox { display: flex; gap: 12px; padding: 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; transition: all 0.2s; }
  .trip-checkbox:hover { border-color: var(--orange); background: white; }
  .trip-checkbox input[type="checkbox"] { width: 20px; height: 20px; cursor: pointer; flex-shrink: 0; margin-top: 2px; }
  
  .trip-info { flex: 1; min-width: 0; }
  .trip-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .trip-date { font-size: 14px; font-weight: 600; color: #111827; }
  .trip-profit { font-size: 15px; font-weight: 700; }
  .trip-profit.positive { color: var(--green); }
  .trip-profit.negative { color: #DC2626; }
  .trip-route { font-size: 14px; color: #374151; margin-bottom: 4px; }
  .trip-meta { font-size: 13px; color: #6B7280; }
  
  .empty-state { padding: 60px 20px; text-align: center; }
  .empty-state svg { color: #D1D5DB; margin: 0 auto 16px; }
  .empty-state p { font-size: 14px; color: #6B7280; }
  
  .trips-list::-webkit-scrollbar { width: 6px; }
  .trips-list::-webkit-scrollbar-track { background: #F3F4F6; border-radius: 3px; }
  .trips-list::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 3px; }
  .trips-list::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
  
  @media (max-width: 1024px) {
    .export-grid { grid-template-columns: 1fr; }
    .options-card { order: 2; }
    .selection-card { order: 1; }
  }
  
  @media (max-width: 640px) {
    .format-buttons { grid-template-columns: 1fr; }
    .date-inputs { flex-direction: column; align-items: stretch; }
    .date-separator { text-align: center; }
  }
</style>