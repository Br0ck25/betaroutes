<script lang="ts">
  import { expenses } from '$lib/stores/expenses';
  import { userSettings } from '$lib/stores/userSettings';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';

  const expenseId = $page.params.id;

  // Use categories from settings, default to basic if empty
  $: categories = $userSettings.expenseCategories?.length > 0 
      ? $userSettings.expenseCategories 
      : ['maintenance', 'insurance', 'supplies', 'other'];

  let formData = {
    date: '',
    category: '',
    amount: '',
    description: ''
  };

  onMount(() => {
      // Find expense in store
      const expense = $expenses.find(e => e.id === expenseId);
      if (expense) {
          formData = {
              date: expense.date,
              category: expense.category,
              amount: expense.amount.toString(),
              description: expense.description || ''
          };
      } else {
          toasts.error('Expense not found.');
          goto('/dashboard/expenses');
      }
  });

  async function saveExpense() {
    if (!formData.amount || !formData.date || !formData.category) {
      toasts.error('Please fill in required fields.');
      return;
    }

    const currentUser = ($page.data as any)['user'] || $user;
    const userId = (currentUser as any)?.name || (currentUser as any)?.token || localStorage.getItem('offline_user_id');
    
    if (!userId) {
      toasts.error('User not identified. Cannot save.');
      return;
    }

    try {
      const payload = {
        ...formData,
        amount: parseFloat(formData.amount)
      };
      
      await expenses.updateExpense(String(expenseId), payload, String(userId));
      toasts.success('Expense updated');
      goto('/dashboard/expenses');
    } catch (err) {
      console.error(err);
      toasts.error('Failed to update expense');
    }
  }

  function getCategoryLabel(cat: string) {
      return cat.charAt(0).toUpperCase() + cat.slice(1);
  }
</script>

<div class="expense-form-page">
  <div class="page-header">
    <div>
        <h1 class="page-title">Edit Expense</h1>
        <p class="page-subtitle">Update cost details</p>
    </div>
    <a href="/dashboard/expenses" class="btn-back">
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Back
    </a>
  </div>

  <div class="form-card">
    <div class="card-header">
        <h2 class="card-title">Expense Details</h2>
    </div>

    <div class="form-grid">
        <div class="form-group">
            <label for="expense-date">Date</label>
            <input id="expense-date" type="date" bind:value={formData.date} required />
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="category">Category</label>
                <div class="select-wrapper">
                    <select id="category" bind:value={formData.category}>
                        {#each categories as cat}
                            <option value={cat}>{getCategoryLabel(cat)}</option>
                        {/each}
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <label for="amount">Amount</label>
                <div class="input-money-wrapper">
                    <span class="symbol">$</span>
                    <input id="amount" type="number" step="0.01" bind:value={formData.amount} placeholder="0.00" />
                </div>
            </div>
        </div>

        <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" bind:value={formData.description} rows="3" placeholder="e.g., Oil Change at Jiffy Lube"></textarea>
        </div>
    </div>

    <div class="form-actions">
        <a href="/dashboard/expenses" class="btn-secondary">Cancel</a>
        <button class="btn-primary" on:click={saveExpense}>Save Changes</button>
    </div>
  </div>
</div>

<style>
  /* MATCHING STYLES FROM TRIPS/NEW */
  .expense-form-page { max-width: 800px; margin: 0 auto; padding: 4px; padding-bottom: 90px; }
  
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; padding: 0 8px; }
  .page-title { font-size: 28px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; display: none; margin: 0; }
  
  .btn-back { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #6B7280; text-decoration: none; font-size: 14px; }
  
  .form-card { background: white; border: 1px solid #E5E7EB; border-radius: 18px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .card-header { margin-bottom: 26px; }
  .card-title { font-size: 22px; font-weight: 700; color: #111827; margin: 0; }

  .form-grid { display: flex; flex-direction: column; gap: 24px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  
  label { font-size: 16px; font-weight: 600; color: #374151; }
  
  input, textarea, select { width: 100%; padding: 16px; border: 1px solid #E5E7EB; border-radius: 12px; font-size: 18px; background: white; box-sizing: border-box; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: #FF7F50; }

  .input-money-wrapper { position: relative; width: 100%; }
  .input-money-wrapper .symbol { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; font-size: 18px; }
  .input-money-wrapper input { padding-left: 36px; }

  .form-actions { display: flex; gap: 18px; margin-top: 36px; padding-top: 26px; border-top: 1px solid #E5E7EB; }
  .btn-primary, .btn-secondary { flex: 1; padding: 18px; border-radius: 12px; font-weight: 600; font-size: 18px; cursor: pointer; border: none; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; }
  .btn-primary { background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; }
  .btn-secondary { background: white; border: 1px solid #E5E7EB; color: #374151; }

  @media (min-width: 768px) {
    .page-subtitle { display: block; }
    .form-card { padding: 48px; }
    .form-actions { justify-content: flex-end; }
    .btn-primary, .btn-secondary { flex: 0 0 auto; width: auto; min-width: 160px; }
  }
</style>