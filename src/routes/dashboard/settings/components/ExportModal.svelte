<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { expenses } from '$lib/stores/expenses';
  import { trips } from '$lib/stores/trips';
  import { csrfFetch } from '$lib/utils/csrf';
  import { generateExpensesCSV, generateTaxBundleCSV, generateTripsCSV } from '../lib/export-utils';

  import { SvelteDate } from '$lib/utils/svelte-reactivity';

  import type { Trip } from '$lib/types';

  interface Props {
    showAdvancedExport?: boolean;
  }

  let {
    showAdvancedExport = $bindable(false),
    onSuccess,
    onError
  }: Props & { onSuccess?: (msg: string) => void; onError?: (msg: string) => void } = $props();

  type Expense = { date?: string };
  let exportDataType: 'trips' | 'expenses' | 'tax-bundle' = $state('trips');
  let exportFormat: 'csv' | 'pdf' = $state('csv');
  let exportDateFrom = $state('');
  let exportDateTo = $state('');
  let exportIncludeSummary = $state(true);

  const filteredTrips = $derived(
    $trips.filter((trip: Trip) => {
      if (!trip.date) return false;
      const tripDate = SvelteDate.from(trip.date!).startOfDay();
      if (
        exportDateFrom &&
        tripDate.getTime() < SvelteDate.from(exportDateFrom).startOfDay().getTime()
      )
        return false;
      if (exportDateTo && tripDate.getTime() > SvelteDate.from(exportDateTo).startOfDay().getTime())
        return false;
      return true;
    })
  );
  const filteredExpenses = $derived(
    $expenses.filter((expense: Expense) => {
      if (!expense.date) return false;
      const expenseDate = SvelteDate.from(expense.date!).startOfDay();
      if (
        exportDateFrom &&
        expenseDate.getTime() < SvelteDate.from(exportDateFrom).startOfDay().getTime()
      )
        return false;
      if (
        exportDateTo &&
        expenseDate.getTime() > SvelteDate.from(exportDateTo).startOfDay().getTime()
      )
        return false;
      return true;
    })
  );

  async function handleAdvancedExport() {
    // PDF Export
    if (exportFormat === 'pdf') {
      // Try client-side PDF first (keeps the flow fast when available)
      try {
        if (exportDataType === 'trips') {
          const { generateTripsPDF } = await import('../lib/export-utils-pdf');
          const doc = await generateTripsPDF(filteredTrips, getDateRangeStr());
          doc.save(`trips-report-${Date.now()}.pdf`);
        } else if (exportDataType === 'expenses') {
          const { generateExpensesPDF } = await import('../lib/export-utils-pdf');
          const doc = await generateExpensesPDF(filteredExpenses, filteredTrips, getDateRangeStr());
          doc.save(`expenses-report-${Date.now()}.pdf`);
        } else if (exportDataType === 'tax-bundle') {
          const { generateTaxBundlePDF } = await import('../lib/export-utils-pdf');
          const doc = await generateTaxBundlePDF(
            filteredTrips,
            filteredExpenses,
            getDateRangeStr()
          );
          doc.save(`tax-bundle-report-${Date.now()}.pdf`);
        }
        onSuccess?.('PDF exported successfully!');
      } catch (err) {
        // If client-side PDF generation fails (e.g. because we stubbed html2canvas/canvg)
        // fallback to server-side PDF generation.
        console.warn('Client-side PDF failed, falling back to server:', err);
        try {
          const body: Record<string, unknown> = {
            type: exportDataType,
            dateRangeStr: getDateRangeStr()
          };
          if (exportDataType === 'trips')
            (body as Record<string, unknown>)['trips'] = filteredTrips as unknown;
          if (exportDataType === 'expenses') {
            (body as Record<string, unknown>)['expenses'] = filteredExpenses as unknown;
            (body as Record<string, unknown>)['trips'] = filteredTrips as unknown;
          }
          if (exportDataType === 'tax-bundle') {
            (body as Record<string, unknown>)['expenses'] = filteredExpenses as unknown;
            (body as Record<string, unknown>)['trips'] = filteredTrips as unknown;
          }

          const res = await csrfFetch('/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          if (!res.ok) {
            const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            onError?.(
              typeof errBody?.error === 'string'
                ? (errBody.error as string)
                : 'Server PDF generation failed'
            );
            return;
          }

          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${exportDataType}-report-${Date.now()}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          onSuccess?.('PDF exported (server) successfully!');
        } catch (e) {
          console.error('Server-side PDF fallback failed:', e);
          onError?.('PDF export failed');
        }
      }
    } else {
      // CSV Export
      if (exportDataType === 'tax-bundle') {
        const csv = generateTaxBundleCSV(filteredTrips, filteredExpenses, getDateRangeStr());
        downloadCSV(csv, 'tax-bundle-export');
        onSuccess?.('Tax Bundle exported successfully!');
      } else if (exportDataType === 'trips') {
        const csv = generateTripsCSV(filteredTrips, exportIncludeSummary);
        downloadCSV(csv, 'trips-export');
        onSuccess?.('Trips exported successfully!');
      } else if (exportDataType === 'expenses') {
        const csv = generateExpensesCSV(filteredExpenses, filteredTrips, exportIncludeSummary);
        downloadCSV(csv, 'expenses-export');
        onSuccess?.('Expenses exported successfully!');
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

  function formatDate(d: string) {
    return SvelteDate.from(d).toLocaleDateString();
  }
</script>

<Modal bind:open={showAdvancedExport} title="Advanced Export">
  <div class="export-modal">
    <fieldset class="export-section">
      <legend class="export-label">Data Type</legend>
      <div class="type-buttons">
        <button
          class="type-btn"
          class:active={exportDataType === 'trips'}
          onclick={() => (exportDataType = 'trips')}
        >
          <span>Trips</span>
        </button>
        <button
          class="type-btn"
          class:active={exportDataType === 'expenses'}
          onclick={() => (exportDataType = 'expenses')}
        >
          <span>Expenses</span>
        </button>
        <button
          class="type-btn tax"
          class:active={exportDataType === 'tax-bundle'}
          onclick={() => (exportDataType = 'tax-bundle')}
        >
          <span>Tax Bundle ⭐</span>
        </button>
      </div>
    </fieldset>

    {#if exportDataType === 'tax-bundle'}
      <div
        style="background: #FFF3CD; border: 2px solid #FF6B35; border-radius: 12px; padding: 16px; margin-bottom: 20px;"
      >
        <div style="color: #DC2626; font-weight: bold;">IMPORTANT IRS RULE</div>
        <div style="font-size: 13px;">
          You must choose ONE deduction method (Standard Mileage OR Actual Expenses). This report
          shows both.
        </div>
      </div>
    {/if}

    <fieldset class="export-section">
      <legend class="export-label">Format</legend>
      <div class="format-buttons">
        <button
          class="format-btn"
          class:active={exportFormat === 'csv'}
          onclick={() => (exportFormat = 'csv')}>CSV</button
        >
        <button
          class="format-btn"
          class:active={exportFormat === 'pdf'}
          onclick={() => (exportFormat = 'pdf')}>PDF</button
        >
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
      <Button variant="outline" className="" action={() => (showAdvancedExport = false)}
        >Cancel</Button
      >
      <Button variant="primary" className="" action={handleAdvancedExport}
        >Export {exportFormat.toUpperCase()}</Button
      >
    </div>
  </div>
</Modal>

<style>
  .export-modal {
    padding: 20px 0;
  }
  .export-section {
    margin-bottom: 24px;
  }
  .export-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 12px;
  }
  .type-buttons,
  .format-buttons {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .format-buttons {
    grid-template-columns: repeat(2, 1fr);
  }
  .type-btn,
  .format-btn {
    padding: 16px;
    background: white;
    border: 2px solid #e5e7eb;
    border-radius: 12px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }
  .type-btn.active,
  .format-btn.active {
    background: #fff7ed;
    border-color: var(--orange, #ff6a3d);
    color: var(--orange, #ff6a3d);
  }
  .date-range {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .date-range input {
    flex: 1;
    padding: 10px;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
  }
  .export-preview {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
    padding: 16px;
    background: #f9fafb;
    border-radius: 12px;
    margin-bottom: 20px;
  }
  .preview-item {
    text-align: center;
  }
  .preview-value {
    font-size: 20px;
    font-weight: 700;
  }
  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    margin-bottom: 20px;
  }
</style>
