<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { expenses } from '$lib/stores/expenses';
  import { currentUser } from '$lib/stores/currentUser';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  
  let exportFormat = 'csv';
  let exportDataType = 'trips'; // 'trips' | 'expenses' | 'tax_bundle'
  let dateFrom = '';
  let dateTo = '';
  let selectedTrips = new Set<string>();
  let selectedExpenses = new Set<string>();
  let selectAll = false;
  let isUpgradeModalOpen = false;

  // Reactive filter logic for Trips
  $: filteredTrips = $trips.filter(trip => {
    if (!trip.date) return false;
    const tripDate = new Date(trip.date);
    if (dateFrom && tripDate < new Date(dateFrom)) return false;
    if (dateTo && tripDate > new Date(dateTo)) return false;
    return true;
  });

  // Reactive filter logic for Expenses
  $: filteredExpenses = $expenses.filter(expense => {
    const dStr = expense.date || expense.createdAt;
    if (!dStr) return false;
    const expenseDate = new Date(dStr);
    if (dateFrom && expenseDate < new Date(dateFrom)) return false;
    if (dateTo && expenseDate > new Date(dateTo)) return false;
    return true;
  });

  // Reactive selection logic
  $: if (selectAll) {
    if (exportDataType === 'trips') {
        selectedTrips = new Set(filteredTrips.map(t => t.id));
    } else if (exportDataType === 'expenses') {
        selectedExpenses = new Set(filteredExpenses.map(e => e.id));
    }
  } else {
     // Auto-check selectAll status based on individual selections
     if (exportDataType === 'trips') {
        if (selectedTrips.size === filteredTrips.length && filteredTrips.length > 0) selectAll = true;
     } else if (exportDataType === 'expenses') {
        if (selectedExpenses.size === filteredExpenses.length && filteredExpenses.length > 0) selectAll = true;
     }
  }

  // Auto-select everything for Tax Bundle
  $: if (exportDataType === 'tax_bundle') {
      selectAll = true;
      selectedTrips = new Set(filteredTrips.map(t => t.id));
      selectedExpenses = new Set(filteredExpenses.map(e => e.id));
  }
  
  // Check Pro Status
  $: isPro = ['pro', 'business', 'premium', 'enterprise'].includes($currentUser?.plan || '');

  function toggleSelectAll() {
    if (selectAll) {
        selectedTrips = new Set();
        selectedExpenses = new Set();
    } else {
        selectedTrips = new Set(filteredTrips.map(t => t.id));
        selectedExpenses = new Set(filteredExpenses.map(e => e.id));
    }
    selectAll = !selectAll;
  }
  
  function toggleTrip(id: string) {
    if (selectedTrips.has(id)) selectedTrips.delete(id);
    else selectedTrips.add(id);
    selectedTrips = selectedTrips;
    selectAll = (selectedTrips.size === filteredTrips.length);
  }

  function toggleExpense(id: string) {
    if (selectedExpenses.has(id)) selectedExpenses.delete(id);
    else selectedExpenses.add(id);
    selectedExpenses = selectedExpenses;
    selectAll = (selectedExpenses.size === filteredExpenses.length);
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
  
  // --- EXPORT LOGIC ---

  function handleExport() {
    // 1. Gate Feature for Pro Users
    if (!isPro) {
        isUpgradeModalOpen = true;
        return;
    }

    if (exportFormat === 'pdf') {
        alert("PDF export requires a library like 'jspdf'. Please install it to enable PDF support.");
        return;
    }

    // 2. Handle different export types
    if (exportDataType === 'trips') {
        const tripsToExport = filteredTrips.filter(t => selectedTrips.has(t.id));
        if (tripsToExport.length === 0) return alert("No trips selected.");
        generateTripCSV(tripsToExport);

    } else if (exportDataType === 'expenses') {
        const expensesToExport = filteredExpenses.filter(e => selectedExpenses.has(e.id));
        if (expensesToExport.length === 0) return alert("No expenses selected.");
        generateExpenseCSV(expensesToExport);

    } else if (exportDataType === 'tax_bundle') {
        if (filteredTrips.length === 0 && filteredExpenses.length === 0) return alert("No data found in this range.");
        
        // Trigger multiple downloads
        if (filteredTrips.length > 0) generateTripCSV(filteredTrips, 'Tax_Mileage_Log');
        
        // Small delay to ensure browser handles multiple downloads
        setTimeout(() => {
            if (filteredExpenses.length > 0) generateExpenseCSV(filteredExpenses, 'Tax_Expense_Log');
        }, 500);

        setTimeout(() => {
            generateTaxSummary(filteredTrips, filteredExpenses);
        }, 1000);
    }
  }

  function generateTripCSV(data: any[], filenamePrefix = 'trips_export') {
    const headers = ['Date', 'Miles', 'Start Address', 'End Address', 'Purpose', 'Vehicle', 'Notes'];
    const rows = data.map(trip => {
      const date = trip.date ? new Date(trip.date).toLocaleDateString() : '';
      const miles = trip.totalMiles || 0;
      const start = `"${(trip.startAddress || '').replace(/"/g, '""')}"`; 
      const end = trip.stops && trip.stops.length > 0
        ? `"${(trip.stops[trip.stops.length - 1].address || '').replace(/"/g, '""')}"` 
        : `"${(trip.endAddress || 'End').replace(/"/g, '""')}"`;
      
      const purpose = `"${(trip.purpose || 'Business').replace(/"/g, '""')}"`;
      const vehicle = `"${(trip.vehicleId || '').replace(/"/g, '""')}"`;
      const notes = `"${(trip.notes || '').replace(/"/g, '""')}"`;

      return [date, miles, start, end, purpose, vehicle, notes].join(',');
    });
    
    downloadFile([headers.join(','), ...rows].join('\n'), `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  }

  function generateExpenseCSV(data: any[], filenamePrefix = 'expenses_export') {
      const headers = ['Date', 'Category', 'Amount', 'Description'];
      const rows = data.map(e => {
          const date = e.date ? new Date(e.date).toLocaleDateString() : '';
          const category = `"${(e.category || 'General').replace(/"/g, '""')}"`;
          const amount = e.amount || 0;
          const desc = `"${(e.description || '').replace(/"/g, '""')}"`;
          return [date, category, amount, desc].join(',');
      });
      downloadFile([headers.join(','), ...rows].join('\n'), `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  }

  function generateTaxSummary(tripsData: any[], expensesData: any[]) {
      const totalMiles = tripsData.reduce((sum, t) => sum + (t.totalMiles || 0), 0);
      const totalExpenses = expensesData.reduce((sum, e) => sum + (e.amount || 0), 0);
      
      // Group expenses by category
      const byCategory: Record<string, number> = {};
      expensesData.forEach(e => {
          const cat = e.category || 'Other';
          byCategory[cat] = (byCategory[cat] || 0) + (e.amount || 0);
      });

      let summary = `TAX SUMMARY REPORT\n`;
      summary += `Generated: ${new Date().toLocaleDateString()}\n`;
      summary += `Period: ${dateFrom || 'Start'} to ${dateTo || 'Present'}\n\n`;
      
      summary += `----------------------------------------\n`;
      summary += `MILEAGE\n`;
      summary += `----------------------------------------\n`;
      summary += `Total Business Miles: ${totalMiles.toFixed(1)}\n`;
      summary += `Total Trips: ${tripsData.length}\n\n`;

      summary += `----------------------------------------\n`;
      summary += `EXPENSES\n`;
      summary += `----------------------------------------\n`;
      summary += `Total Expenses: $${totalExpenses.toFixed(2)}\n`;
      Object.entries(byCategory).forEach(([cat, amt]) => {
          summary += `  - ${cat}: $${amt.toFixed(2)}\n`;
      });
      
      downloadFile(summary, `Tax_Summary_${new Date().getFullYear()}.txt`, 'text/plain');
  }

  function downloadFile(content: string, fileName: string, mimeType: string) {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
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
      <h3 class="option-label">Data Type</h3>
      <div class="format-buttons">
        <button class="format-btn" class:active={exportDataType === 'trips'} on:click={() => exportDataType = 'trips'}>Trips</button>
        <button class="format-btn" class:active={exportDataType === 'expenses'} on:click={() => exportDataType = 'expenses'}>Expenses</button>
        <button class="format-btn full-width" class:active={exportDataType === 'tax_bundle'} on:click={() => exportDataType = 'tax_bundle'}>Tax Bundle (All)</button>
      </div>
    </div>

    {#if exportDataType !== 'tax_bundle'}
    <div class="option-group">
      <h3 class="option-label">Format</h3>
      <div class="format-buttons">
        <button class="format-btn" class:active={exportFormat === 'csv'} on:click={() => exportFormat = 'csv'}>CSV (Excel)</button>
        <button class="format-btn" class:active={exportFormat === 'pdf'} on:click={() => exportFormat = 'pdf'}>PDF (Print)</button>
      </div>
    </div>
    {/if}
    
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
    
    <button 
      class="btn-action" 
      on:click={handleExport} 
      disabled={exportDataType !== 'tax_bundle' && (exportDataType === 'trips' ? selectedTrips.size === 0 : selectedExpenses.size === 0)}
      title={!isPro ? "Upgrade to Export" : "Export Data"}
    >
      {#if !isPro}🔒{/if} 
      {#if exportDataType === 'tax_bundle'}
        Download Tax Package
      {:else}
        Export {exportDataType === 'trips' ? selectedTrips.size : selectedExpenses.size} Item{selectedTrips.size !== 1 && selectedExpenses.size !== 1 ? 's' : ''}
      {/if}
    </button>
  </div>
  
  <div class="selection-card">
    <div class="selection-header">
      <h2 class="card-title">
          {#if exportDataType === 'tax_bundle'}
            2. Review Summary
          {:else}
            2. Select {exportDataType === 'trips' ? 'Trips' : 'Expenses'}
          {/if}
      </h2>
      {#if exportDataType !== 'tax_bundle'}
      <button class="btn-text" on:click={toggleSelectAll}>{selectAll ? 'Deselect All' : 'Select All'}</button>
      {/if}
    </div>
    
    <div class="trips-list">
        {#if exportDataType === 'tax_bundle'}
             <div class="summary-preview">
                 <div class="summary-stat">
                     <span class="label">Total Miles</span>
                     <span class="value">{filteredTrips.reduce((s,t) => s + (t.totalMiles||0), 0).toFixed(1)}</span>
                 </div>
                 <div class="summary-stat">
                     <span class="label">Total Expenses</span>
                     <span class="value">${filteredExpenses.reduce((s,e) => s + (e.amount||0), 0).toFixed(2)}</span>
                 </div>
                 <div class="summary-note">
                     Includes {filteredTrips.length} trips and {filteredExpenses.length} expense records.
                 </div>
             </div>
        {:else if exportDataType === 'trips'}
            {#if filteredTrips.length > 0}
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
            {:else}
                <div class="empty-state">No trips found</div>
            {/if}
        {:else if exportDataType === 'expenses'}
            {#if filteredExpenses.length > 0}
                {#each filteredExpenses as expense (expense.id)}
                <label class="trip-item" class:selected={selectedExpenses.has(expense.id)}>
                    <input type="checkbox" checked={selectedExpenses.has(expense.id)} on:change={() => toggleExpense(expense.id)} />
                    <div class="trip-content">
                    <div class="trip-top">
                        <span class="trip-date">{formatDate(expense.date || expense.createdAt)}</span>
                        <span class="trip-miles">${expense.amount?.toFixed(2)}</span>
                    </div>
                    <div class="trip-route">
                        {expense.category || 'General'}
                        {#if expense.description} - {expense.description}{/if}
                    </div>
                    </div>
                </label>
                {/each}
            {:else}
                <div class="empty-state">No expenses found</div>
            {/if}
        {/if}
    </div>
  </div>
</div>

<Modal bind:open={isUpgradeModalOpen} title="Upgrade to Pro">
  <div class="space-y-6 text-center py-4">
        <div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-3xl">🚀</span>
        </div>
        
        <h3 class="text-xl font-bold text-gray-900">
            Unlock Pro Features
        </h3>
        
        <p class="text-gray-600 text-base leading-relaxed">
            Data Export is a Pro feature.
            Upgrade now to download your trip history for taxes!
        </p>

        <div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">Unlimited Stops per Trip</span>
             </div>
             <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">One-Click Route Optimization</span>
            </div>
            <div class="flex items-center gap-2">
                 <span class="text-green-500 text-lg">✓</span>
                 <span class="text-gray-700">Unlimited Monthly Trips</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500 text-lg">✓</span>
                <span class="text-gray-700">Data Export</span>
            </div>
        </div>

        <div class="flex gap-3 justify-center pt-2">
            <Button variant="outline" on:click={() => isUpgradeModalOpen = false}>
                Maybe Later
            </Button>
            <a 
                href="/dashboard/settings" 
                class="inline-flex items-center justify-center rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 transition-all"
            >
                Upgrade Now
            </a>
        </div>
    </div>
</Modal>

<style>
  .export-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
  .options-card, .selection-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 20px; }
  .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #111827; }
  .option-group { margin-bottom: 24px; }
  .option-label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 8px; }
  .format-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .format-btn { padding: 12px; border: 2px solid #E5E7EB; border-radius: 10px; background: white; font-weight: 600; font-size: 14px; color: #6B7280; cursor: pointer; }
  .format-btn.active { border-color: #FF7F50; color: #FF7F50; background: #FFF5F2; }
  .format-btn.full-width { grid-column: span 2; }
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
  
  .summary-preview { padding: 16px; background: #F9FAFB; border-radius: 12px; border: 1px solid #E5E7EB; }
  .summary-stat { display: flex; justify-content: space-between; margin-bottom: 8px; font-weight: 600; color: #111827; }
  .summary-note { margin-top: 16px; font-size: 12px; color: #6B7280; text-align: center; }

  @media (min-width: 1024px) {
    .export-grid { grid-template-columns: 350px 1fr; align-items: start; }
  }
</style>