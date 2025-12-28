<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import { trips } from '$lib/stores/trips';
  import { expenses } from '$lib/stores/expenses';
  import { generateTripsCSV, generateExpensesCSV, generateTripsPDF, generateExpensesPDF } from '../lib/export-utils';
  import { createEventDispatcher } from 'svelte';

  export let showAdvancedExport = false;

  const dispatch = createEventDispatcher();

  let exportDataType: 'trips' | 'expenses' | 'tax-bundle' = 'trips';
  let exportFormat: 'csv' | 'pdf' = 'csv';
  let exportDateFrom = '';
  let exportDateTo = '';
  let exportIncludeSummary = true;

  $: filteredTrips = $trips.filter(trip => {
    if (!trip.date) return false;
    const tripDate = new Date(trip.date);
    if (exportDateFrom && tripDate < new Date(exportDateFrom)) return false;
    if (exportDateTo && tripDate > new Date(exportDateTo)) return false;
    return true;
  });

  $: filteredExpenses = $expenses.filter(expense => {
    if (!expense.date) return false;
    const expenseDate = new Date(expense.date);
    if (exportDateFrom && expenseDate < new Date(exportDateFrom)) return false;
    if (exportDateTo && expenseDate > new Date(exportDateTo)) return false;
    return true;
  });

  async function handleAdvancedExport() {
    // PDF Export
    if (exportFormat === 'pdf') {
       if (exportDataType === 'trips') {
           const doc = await generateTripsPDF(filteredTrips, getDateRangeStr());
           doc.save(`trips-report-${Date.now()}.pdf`);
       } else if (exportDataType === 'expenses') {
           const doc = await generateExpensesPDF(filteredExpenses, filteredTrips, getDateRangeStr());
           doc.save(`expenses-report-${Date.now()}.pdf`);
       } else if (exportDataType === 'tax-bundle') {
           // For PDF tax bundle, we usually do the full logic which is complex.
           // For simplicity, we trigger the tax bundle logic in parent or import it here if needed.
           // Since the logic was massive, let's assume we call a function we imported or moved.
           // Note: In the refactor, generateTaxBundlePDF should be imported from export-utils.
           // I'll emit an event for simplicity if it requires too much local state, 
           // otherwise import from utils.
           dispatch('exportTaxBundle', { trips: filteredTrips, expenses: filteredExpenses, dateRange: getDateRangeStr() });
       }
       dispatch('success', 'PDF exported successfully!');
    } else {
       // CSV Export
       if (exportDataType === 'tax-bundle') {
           dispatch('exportTaxBundle', { trips: filteredTrips, expenses: filteredExpenses, dateRange: getDateRangeStr(), format: 'csv' });
       } else if (exportDataType === 'trips') {
           const csv = generateTripsCSV(filteredTrips, exportIncludeSummary);
           downloadCSV(csv, 'trips-export');
           dispatch('success', 'Trips exported successfully!');
       } else if (exportDataType === 'expenses') {
           const csv = generateExpensesCSV(filteredExpenses, filteredTrips, exportIncludeSummary);
           downloadCSV(csv, 'expenses-export');
           dispatch('success', 'Expenses exported successfully!');
       }
    }
    showAdvancedExport = false;
  }
  
  function downloadCSV(csv: string | null, name: string) {
      if (!csv) return;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
  }

  function getDateRangeStr() {
      return exportDateFrom && exportDateTo 
      ? `${formatDate(exportDateFrom)} - ${formatDate(exportDateTo)}`
      : exportDateFrom 
        ? `From ${formatDate(exportDateFrom)}`
        : exportDateTo 
          ? `Through ${formatDate(exportDateTo)}`
          : 'All Records';
  }
  
  function formatDate(d: string) { return new Date(d).toLocaleDateString(); }
</script>

<Modal bind:open={showAdvancedExport} title="Advanced Export">
  <div class="export-modal">
    <fieldset class="export-section">
      <legend class="export-label">Data Type</legend>
      <div class="type-buttons">
        <button class="type-btn" class:active={exportDataType === 'trips'} on:click={() => exportDataType = 'trips'}>
          <span>Trips</span>
        </button>
        <button class="type-btn" class:active={exportDataType === 'expenses'} on:click={() => exportDataType = 'expenses'}>
          <span>Expenses</span>
        </button>
        <button class="type-btn tax" class:active={exportDataType === 'tax-bundle'} on:click={() => exportDataType = 'tax-bundle'}>
          <span>Tax Bundle ⭐</span>
        </button>
      </div>
    </fieldset>
    
    {#if exportDataType === 'tax-bundle'}
      <div style="background: #FFF3CD; border: 2px solid #FF6B35; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
        <div style="color: #DC2626; font-weight: bold;">IMPORTANT IRS RULE</div>
        <div style="font-size: 13px;">You must choose ONE deduction method (Standard Mileage OR Actual Expenses). This report shows both.</div>
      </div>
    {/if}

    <fieldset class="export-section">
      <legend class="export-label">Format</legend>
      <div class="format-buttons">
        <button class="format-btn" class:active={exportFormat === 'csv'} on:click={() => exportFormat = 'csv'}>CSV</button>
        <button class="format-btn" class:active={exportFormat === 'pdf'} on:click={() => exportFormat = 'pdf'}>PDF</button>
      </div>
    </fieldset>

    <fieldset class="export-section">
      <legend class="export-label">Date Range (Optional)</legend>
      <div class="date-range">
        <input id="adv-export-date-from" type="date" bind:value={exportDateFrom} />
        <span>to</span>
        <input id="adv-export-date-to" type="date" bind:value={exportDateTo} />
      </div>
    </fieldset>
    
    <div class="export-preview">
        <div class="preview-item">
          <div class="preview-label">Trips</div>
          <div class="preview-value">{filteredTrips.length}</div>
        </div>
        {#if exportDataType !== 'trips'}
        <div class="preview-item">
          <div class="preview-label">Expenses</div>
          <div class="preview-value">{filteredExpenses.length}</div>
        </div>
        {/if}
    </div>

    {#if exportDataType !== 'tax-bundle' && exportFormat === 'csv'}
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={exportIncludeSummary} />
        Include summary totals
      </label>
    {/if}

    <div class="modal-actions">
      <button class="btn-secondary" on:click={() => showAdvancedExport = false}>Cancel</button>
      <button class="btn-primary" on:click={handleAdvancedExport}>
        Export {exportFormat.toUpperCase()}
      </button>
    </div>
  </div>
</Modal>

<style>
  .export-modal { padding: 20px 0; }
  .export-section { margin-bottom: 24px; }
  .export-label { display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; }
  .type-buttons, .format-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .format-buttons { grid-template-columns: repeat(2, 1fr); }
  .type-btn, .format-btn { padding: 16px; background: white; border: 2px solid #E5E7EB; border-radius: 12px; cursor: pointer; font-size: 14px; font-weight: 500; }
  .type-btn.active, .format-btn.active { background: #FFF7ED; border-color: var(--orange, #FF6A3D); color: var(--orange, #FF6A3D); }
  .date-range { display: flex; align-items: center; gap: 12px; }
  .date-range input { flex: 1; padding: 10px; border: 2px solid #E5E7EB; border-radius: 8px; }
  .export-preview { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; padding: 16px; background: #F9FAFB; border-radius: 12px; margin-bottom: 20px; }
  .preview-item { text-align: center; }
  .preview-value { font-size: 20px; font-weight: 700; }
  .modal-actions { display: flex; gap: 12px; margin-top: 24px; }
  .modal-actions button { flex: 1; padding: 14px; border-radius: 10px; font-weight: 600; cursor: pointer; }
  .btn-primary { background: var(--orange, #FF6A3D); color: white; border: none; }
  .btn-secondary { background: white; border: 2px solid #E5E7EB; }
  .checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 20px; }
</style>