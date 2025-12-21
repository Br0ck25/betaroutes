<script lang="ts">
  import { expenses, isLoading as expensesLoading } from '$lib/stores/expenses';
  import { trips, isLoading as tripsLoading } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { user } from '$lib/stores/auth';
  import { toasts } from '$lib/stores/toast';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { onMount, onDestroy } from 'svelte';

  // --- STATE ---
  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterCategory = 'all';
  let startDate = '';
  let endDate = '';
   
  // Selection State
  let selectedExpenses = new Set<string>();

  // Add reactive statement to toggle body class for hiding footer
  $: if (typeof document !== 'undefined') {
    if (selectedExpenses.size > 0) {
      document.body.classList.add('has-selections');
    } else {
      document.body.classList.remove('has-selections');
    }
  }

  // Clean up body class when component is destroyed
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('has-selections');
    }
  });

  // Use categories from settings, default to basic if empty
  $: categories = $userSettings.expenseCategories?.length > 0 
      ? $userSettings.expenseCategories 
      : ['maintenance', 'insurance', 'supplies', 'other'];

  // --- MODAL STATE (Only for Categories now) ---
  let isManageCategoriesOpen = false;
  let newCategoryName = '';

  // --- DERIVE TRIP EXPENSES ---
  $: tripExpenses = $trips.flatMap(trip => {
      const items = [];
      const date = trip.date || trip.createdAt.split('T')[0];
      
      // 1. Fuel
      if (trip.fuelCost && trip.fuelCost > 0) {
          items.push({
              id: `trip-fuel-${trip.id}`,
              date: date,
              category: 'fuel',
              amount: trip.fuelCost,
              description: 'Fuel (Trip Log)',
              source: 'trip',
              tripId: trip.id
          });
      }

      // 2. Maintenance Items
      if (trip.maintenanceItems?.length) {
          trip.maintenanceItems.forEach((item, i) => {
              items.push({
                  id: `trip-maint-${trip.id}-${i}`,
                  date: date,
                  category: 'maintenance',
                  amount: item.cost,
                  description: `${item.type} (Trip Log)`,
                  source: 'trip',
                  tripId: trip.id
              });
          });
      }

      // 3. Supply Items
      const supplies = trip.supplyItems || trip.suppliesItems || [];
      if (supplies.length) {
          supplies.forEach((item, i) => {
              items.push({
                  id: `trip-supply-${trip.id}-${i}`,
                  date: date,
                  category: 'supplies',
                  amount: item.cost,
                  description: `${item.type} (Trip Log)`,
                  source: 'trip',
                  tripId: trip.id
              });
          });
      }

      return items;
  });

  // --- COMBINE & FILTER ---
  $: allExpenses = [...$expenses, ...tripExpenses];
   
  // Reset selection when filters change
  $: if (searchQuery || sortBy || sortOrder || filterCategory || startDate || endDate) {
      selectedExpenses = new Set();
  }

  $: filteredExpenses = allExpenses
    .filter(item => {
      // Search
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query || 
        (item.description && item.description.toLowerCase().includes(query)) ||
        item.amount.toString().includes(query) ||
        (item.source === 'trip' && 'trip log'.includes(query));
      
      if (!matchesSearch) return false;

      // Category
      if (filterCategory !== 'all' && item.category !== filterCategory) return false;

      // Date Range
      if (item.date) {
        const itemDate = new Date(item.date);
        itemDate.setHours(0,0,0,0);
        
        if (startDate) {
           const start = new Date(startDate);
           start.setHours(0,0,0,0);
           if (itemDate < start) return false;
        }
        if (endDate) {
           const end = new Date(endDate);
           end.setHours(0,0,0,0);
           if (itemDate > end) return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;
      if (sortBy === 'date') {
        aVal = new Date(a.date || 0).getTime();
        bVal = new Date(b.date || 0).getTime();
      } else {
        aVal = a.amount;
        bVal = b.amount;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

  $: totalAmount = filteredExpenses.reduce((sum, item) => sum + (item.amount || 0), 0);
  $: loading = $expensesLoading || $tripsLoading;
  $: allSelected = filteredExpenses.length > 0 && selectedExpenses.size === filteredExpenses.length;

  // --- ACTIONS ---
  function goToAdd() {
    goto('/dashboard/expenses/new');
  }

  function editExpense(expense: any) {
    if (expense.source === 'trip') {
      goto(`/dashboard/trips?id=${expense.tripId}`);
    } else {
      goto(`/dashboard/expenses/edit/${expense.id}`);
    }
  }

  async function deleteExpense(id: string, e?: MouseEvent) {
    if (e) e.stopPropagation();
    if (!confirm('Move this expense to trash? You can restore it later.')) return;
    
    // Check if it's a trip log
    if (id.startsWith('trip-')) {
        toasts.error('Cannot delete Trip Logs here. Delete the Trip instead.');
        return;
    }

    const currentUser = $page.data.user || $user;
    const userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
    if (userId) {
      try {
        await expenses.deleteExpense(id, userId);
        toasts.success('Expense moved to trash');
        if (selectedExpenses.has(id)) {
            selectedExpenses.delete(id);
            selectedExpenses = selectedExpenses;
        }
      } catch (err) {
        console.error(err);
        toasts.error('Failed to move to trash');
      }
    }
  }

  // --- SELECTION LOGIC ---
  function toggleSelection(id: string) {
      if (selectedExpenses.has(id)) selectedExpenses.delete(id);
      else selectedExpenses.add(id);
      selectedExpenses = selectedExpenses;
  }

  function toggleSelectAll() {
      if (allSelected) selectedExpenses = new Set();
      else selectedExpenses = new Set(filteredExpenses.map(e => e.id));
  }

  async function deleteSelected() {
      const ids = Array.from(selectedExpenses);
      const manualExpenses = ids.filter(id => !id.startsWith('trip-'));
      const tripLogs = ids.length - manualExpenses.length;

      if (manualExpenses.length === 0 && tripLogs > 0) {
          toasts.error(`Cannot delete ${tripLogs} Trip Logs. Edit them in Trips.`);
          return;
      }

      if (!confirm(`Move ${manualExpenses.length} expenses to trash? ${tripLogs > 0 ? `(${tripLogs} trip logs will be skipped)` : ''}`)) return;

      const currentUser = $page.data.user || $user;
      const userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
      
      if (!userId) return;

      let successCount = 0;
      for (const id of manualExpenses) {
          try {
              await expenses.deleteExpense(id, userId);
              successCount++;
          } catch (err) {
              console.error(`Failed to delete ${id}`, err);
          }
      }
      
      toasts.success(`Moved ${successCount} expenses to trash.`);
      selectedExpenses = new Set();
  }

  function exportSelected() {
      const selectedData = filteredExpenses.filter(e => selectedExpenses.has(e.id));
      if (selectedData.length === 0) return;

      const headers = ['Date', 'Category', 'Amount', 'Description', 'Source'];
      const rows = selectedData.map(e => [
          e.date,
          e.category,
          e.amount,
          `"${(e.description || '').replace(/"/g, '""')}"`,
          e.source === 'trip' ? 'Trip Log' : 'Manual'
      ].join(','));

      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      
      toasts.success(`Exported ${selectedData.length} items.`);
      selectedExpenses = new Set();
  }

  // --- CATEGORY MANAGEMENT ---
  async function updateCategories(newCategories: string[]) {
      userSettings.update(s => ({ ...s, expenseCategories: newCategories }));
      try {
          await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ expenseCategories: newCategories })
          });
      } catch (e) {
          console.error('Failed to sync settings', e);
          toasts.error('Saved locally, but sync failed');
      }
  }

  async function addCategory() {
      if (!newCategoryName.trim()) return;
      const val = newCategoryName.trim().toLowerCase();
      if (categories.includes(val)) {
          toasts.error('Category already exists');
          return;
      }
      const updated = [...categories, val];
      await updateCategories(updated);
      newCategoryName = '';
      toasts.success('Category added');
  }

  async function removeCategory(cat: string) {
      if (!confirm(`Delete "${cat}" category? Existing expenses will keep this category.`)) return;
      const updated = categories.filter(c => c !== cat);
      await updateCategories(updated);
      toasts.success('Category removed');
  }

  // --- HELPERS ---
  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  function getCategoryLabel(cat: string) {
      return cat.charAt(0).toUpperCase() + cat.slice(1);
  }

  function getCategoryColor(cat: string) {
      if (cat === 'fuel') return 'text-red-600 bg-red-50 border-red-200';
      const colors = [
          'text-blue-600 bg-blue-50 border-blue-200',
          'text-purple-600 bg-purple-50 border-purple-200',
          'text-orange-600 bg-orange-50 border-orange-200',
          'text-green-600 bg-green-50 border-green-200',
          'text-pink-600 bg-pink-50 border-pink-200',
          'text-indigo-600 bg-indigo-50 border-indigo-200',
      ];
      if (cat === 'maintenance') return colors[0];
      if (cat === 'insurance') return colors[1];
      if (cat === 'supplies') return colors[2];
      const sum = cat.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return colors[sum % colors.length];
  }

  // Swipe Action
  function swipeable(node: HTMLElement, { onEdit, onDelete, isReadOnly }: { onEdit: () => void, onDelete: (e: any) => void, isReadOnly: boolean }) {
    if (isReadOnly) return;
    let startX = 0;
    let x = 0;
    let swiping = false;

    function handleTouchStart(e: TouchEvent) {
        startX = e.touches[0].clientX;
        x = 0;
        node.style.transition = 'none';
    }

    function handleTouchMove(e: TouchEvent) {
        const dx = e.touches[0].clientX - startX;
        swiping = true;
        if (dx < -120) x = -120;
        else if (dx > 120) x = 120;
        else x = dx;
        node.style.transform = `translateX(${x}px)`;
        if (Math.abs(x) > 10) e.preventDefault();
    }

    function handleTouchEnd() {
        if (!swiping) return;
        swiping = false;
        node.style.transition = 'transform 0.2s ease-out';
        if (x < -80) onDelete({ stopPropagation: () => {} });
        else if (x > 80) onEdit();
        node.style.transform = 'translateX(0)';
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: false });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd);
    return {
        destroy() {
            node.removeEventListener('touchstart', handleTouchStart);
            node.removeEventListener('touchmove', handleTouchMove);
            node.removeEventListener('touchend', handleTouchEnd);
        }
    }
  }
</script>

<svelte:head>
  <title>Expenses - Go Route Yourself</title>
</svelte:head>

<div class="page-container">
  <div class="page-header">
    <div class="header-text">
      <h1 class="page-title">Expenses</h1>
      <p class="page-subtitle">Track maintenance, supplies, and other costs</p>
    </div>
     
    <div class="header-actions">
        <button class="btn-secondary" on:click={() => goto('/dashboard/trash')} aria-label="View Trash">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        </button>

        <button class="btn-secondary" on:click={() => isManageCategoriesOpen = true} aria-label="Manage Categories">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        
        <button class="btn-primary" on:click={goToAdd}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          New Expense
        </button>
    </div>
  </div>
   
  <div class="stats-summary">
    <div class="summary-card">
      <div class="summary-label">Total Expenses</div>
      <div class="summary-value">{filteredExpenses.length}</div>
    </div>
     
    <div class="summary-card">
      <div class="summary-label">Total Cost</div>
      <div class="summary-value">
        {formatCurrency(totalAmount)}
      </div>
    </div>
     
    {#if categories[0]}
        <div class="summary-card hidden-mobile">
        <div class="summary-label">{getCategoryLabel(categories[0])}</div>
        <div class="summary-value">
            {formatCurrency(filteredExpenses.filter(e => e.category === categories[0]).reduce((s, e) => s + e.amount, 0))}
        </div>
        </div>
    {/if}
    {#if categories[1]}
        <div class="summary-card hidden-mobile">
        <div class="summary-label">{getCategoryLabel(categories[1])}</div>
        <div class="summary-value">
            {formatCurrency(filteredExpenses.filter(e => e.category === categories[1]).reduce((s, e) => s + e.amount, 0))}
        </div>
        </div>
    {/if}
  </div>

  <div class="filters-bar sticky-bar">
    <div class="search-box">
      <svg class="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 19L14.65 14.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input type="text" placeholder="Search expenses..." bind:value={searchQuery} />
    </div>
     
    <div class="filter-group date-group">
        <input type="date" bind:value={startDate} class="date-input" aria-label="Start Date" />
        <span class="date-sep">-</span>
        <input type="date" bind:value={endDate} class="date-input" aria-label="End Date" />
    </div>
     
    <div class="filter-group">
      <select bind:value={filterCategory} class="filter-select">
        <option value="all">All Categories</option>
        {#each categories as cat}
              <option value={cat}>{getCategoryLabel(cat)}</option>
        {/each}
        <option value="fuel">Fuel (Trips)</option>
      </select>
       
      <select bind:value={sortBy} class="filter-select">
        <option value="date">By Date</option>
        <option value="amount">By Cost</option>
      </select>
       
      <button class="sort-btn" on:click={() => sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})">
            <path d="M10 3V17M10 17L4 11M10 17L16 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
   
  {#if filteredExpenses.length > 0}
    <div class="batch-header" class:visible={filteredExpenses.length > 0}>
        <label class="checkbox-container">
            <input type="checkbox" checked={allSelected} on:change={toggleSelectAll} />
            <span class="checkmark"></span>
            Select All ({filteredExpenses.length})
        </label>
        
        <span class="page-info">Showing {filteredExpenses.length} items</span>
    </div>
  {/if}

  {#if loading}
    <div class="expense-list-cards">
      {#each Array(3) as _}
        <div class="expense-card">
          <div class="card-top">
            <div style="flex: 1">
               <Skeleton height="16px" width="30%" className="mb-2" />
               <Skeleton height="20px" width="60%" />
            </div>
            <Skeleton height="24px" width="60px" />
          </div>
        </div>
      {/each}
    </div>
  {:else if filteredExpenses.length > 0}
    <div class="expense-list-cards">
      {#each filteredExpenses as expense (expense.id)}
        {@const isSelected = selectedExpenses.has(expense.id)}
        <div class="card-wrapper">
            {#if expense.source !== 'trip'}
                <div class="swipe-bg">
                    <div class="swipe-action edit"><span>Edit</span></div>
                    <div class="swipe-action delete"><span>Trash</span></div>
                </div>
            {/if}

            <div 
                class="expense-card" 
                class:read-only={expense.source === 'trip'}
                class:selected={isSelected}
                on:click={() => editExpense(expense)}
                role="button"
                tabindex="0"
                on:keypress={(e) => e.key === 'Enter' && editExpense(expense)}
                use:swipeable={{
                    onEdit: () => editExpense(expense),
                    onDelete: (e) => deleteExpense(expense.id, e),
                    isReadOnly: expense.source === 'trip'
                }}
            >
                <div class="card-top">
                    <div class="selection-box" on:click|stopPropagation on:keydown|stopPropagation role="none">
                        <label class="checkbox-container">
                            <input 
                                type="checkbox" 
                                checked={isSelected} 
                                on:change={() => toggleSelection(expense.id)} 
                            />
                            <span class="checkmark"></span>
                        </label>
                    </div>

                    <div class="expense-main-info">
                        <span class="expense-date-display">
                            {formatDate(expense.date)}
                        </span>
                        
                        <h3 class="expense-desc-title">
                            {expense.description || 'No description'}
                        </h3>
                    </div>

                    <div class="expense-amount-display">
                        {formatCurrency(expense.amount)}
                    </div>
                    
                    <svg class="nav-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
                       <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </div>

                <div class="card-stats">
                     <div class="stat-badge-container">
                        <span class={`category-badge ${getCategoryColor(expense.category)}`}>
                             {getCategoryLabel(expense.category)}
                        </span>
                        {#if expense.source === 'trip'}
                            <span class="source-badge">Trip Log</span>
                        {/if}
                     </div>
                </div>
            </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <p>No expenses found matching your filters.</p>
    </div>
  {/if}
</div>

{#if selectedExpenses.size > 0}
    <div class="action-bar-container" data-has-selections="true">
        <div class="action-bar">
            <div class="action-bar-left">
                <div class="selection-indicator">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span class="selected-count">{selectedExpenses.size} {selectedExpenses.size === 1 ? 'expense' : 'expenses'} selected</span>
                </div>
            </div>
            
            <div class="action-bar-right">
                <button class="action-pill secondary" on:click={() => selectedExpenses = new Set()}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span class="action-text">Cancel</span>
                </button>
                
                <button class="action-pill export" on:click={exportSelected}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span class="action-text">Export</span>
                </button>
    
                <button class="action-pill danger" on:click={deleteSelected}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    <span class="action-text">Delete</span>
                </button>
            </div>
        </div>
    </div>
{/if}

<Modal bind:open={isManageCategoriesOpen} title="Manage Categories">
    <div class="categories-manager">
        <p class="text-sm text-gray-500 mb-4">Add or remove expense categories. These are saved to your settings.</p>
        
        <div class="cat-list">
            {#each categories as cat}
                <div class="cat-item">
                    <span class={`cat-badge ${getCategoryColor(cat)}`}>{getCategoryLabel(cat)}</span>
                    <button class="cat-delete" on:click={() => removeCategory(cat)} aria-label="Delete Category">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            {:else}
                <div class="text-sm text-gray-400 italic text-center py-4">No categories. Add one below.</div>
            {/each}
        </div>

        <div class="add-cat-form">
            <input 
                type="text" 
                bind:value={newCategoryName} 
                placeholder="New Category Name..." 
                class="input-field"
                on:keydown={(e) => e.key === 'Enter' && addCategory()}
            />
            <button class="btn-secondary" on:click={addCategory}>Add</button>
        </div>
        
        <div class="modal-actions mt-6">
            <button class="btn-cancel w-full" on:click={() => isManageCategoriesOpen = false}>Done</button>
        </div>
    </div>
</Modal>

<style>
  * {
    box-sizing: border-box;
  }

  :global(body) {
    overflow-x: hidden;
  }

  .page-container { 
    max-width: 1200px; 
    margin: 0 auto; 
    padding: 12px; 
    padding-bottom: 80px;
    overflow-x: hidden;
  }

  /* Page Headers & Actions */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .header-actions { display: flex; gap: 8px; }

  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; 
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; 
    border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; 
    box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); transition: transform 0.1s; text-decoration: none; }
  .btn-primary:active { transform: translateY(1px); }

  .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px; 
    background: white; border: 1px solid #E5E7EB; color: #374151; border-radius: 8px; 
    font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; }

  @media (hover: hover) {
    .btn-secondary:hover { background: #F9FAFB; }
    .cat-delete:hover { background: #EF4444; color: white; }
  }

  /* Stats Summary */
  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }

  /* Filter Bar */
  .filters-bar { 
    display: flex; 
    flex-direction: column; 
    gap: 12px; 
    margin-bottom: 20px;
    max-width: 100%;
    overflow-x: hidden;
  }
  
  .sticky-bar { 
    position: sticky; 
    top: 0; 
    z-index: 10; 
    background: #F9FAFB; 
    padding: 10px 12px; 
    margin: -12px -12px 10px -12px; 
    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
  }

  .search-box { position: relative; width: 100%; max-width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { 
    width: 100%; 
    max-width: 100%;
    padding: 12px 16px 12px 42px; 
    border: 1px solid #E5E7EB; 
    border-radius: 10px; 
    font-size: 16px; 
    background: white;
  }
   
  .date-group, .filter-group { display: flex; gap: 8px; align-items: center; width: 100%; max-width: 100%; }
  .filter-group { width: 100%; }
  
  .date-input, .filter-select { 
    flex: 1; 
    padding: 12px; 
    border: 1px solid #E5E7EB; 
    border-radius: 10px; 
    font-size: 16px; 
    background: white; 
    min-width: 0;
    max-width: 100%;
  }
  
  .date-sep { color: #9CA3AF; font-weight: bold; }
  .sort-btn { 
    flex: 0 0 48px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    border: 1px solid #E5E7EB; 
    border-radius: 10px; 
    background: white; 
    color: #6B7280; 
    cursor: pointer; 
  }

  /* Batch Header */
  .batch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px; color: #6B7280; font-size: 13px; font-weight: 500; }
  .page-info { font-size: 13px; }

  /* CHECKBOX STYLES */
  .checkbox-container { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; color: #4B5563; position: relative; padding-left: 28px; user-select: none; }
  .checkbox-container input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
  .checkmark { position: absolute; top: 0; left: 0; height: 20px; width: 20px; background-color: white; border: 2px solid #D1D5DB; border-radius: 6px; transition: all 0.2s; }
  
  @media (hover: hover) {
    .checkbox-container:hover input ~ .checkmark { border-color: #9CA3AF; }
  }
  
  .checkbox-container input:checked ~ .checkmark { background-color: #FF7F50; border-color: #FF7F50; }
  .checkmark:after { content: ""; position: absolute; display: none; }
  .checkbox-container input:checked ~ .checkmark:after { display: block; }
  .checkbox-container .checkmark:after { left: 6px; top: 2px; width: 5px; height: 10px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }

  /* Expense List & Cards (Styled like Trips) */
  .expense-list-cards { display: flex; flex-direction: column; gap: 12px; max-width: 100%; }
  .card-wrapper { position: relative; overflow: hidden; border-radius: 12px; background: #F3F4F6; max-width: 100%; }
   
  .swipe-bg { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; 
    padding: 0 20px; z-index: 0; }
  .swipe-action { font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .swipe-action.edit { color: #2563EB; }
  .swipe-action.delete { color: #DC2626; }

  .expense-card { 
    background: white; 
    border: 1px solid #E5E7EB; 
    border-radius: 12px; 
    padding: 16px; 
    position: relative; 
    z-index: 1; 
    cursor: pointer; 
    transition: all 0.2s;
    max-width: 100%;
  }
  .expense-card:active { background-color: #F9FAFB; }
  .expense-card.read-only { border-left: 4px solid #3B82F6; background: #FAFAFA; }
  .expense-card.selected { background-color: #FFF7ED; border-color: #FF7F50; }
   
  .card-top { 
    display: grid; 
    grid-template-columns: auto 1fr auto auto; 
    align-items: center; 
    gap: 12px; 
    padding-bottom: 12px; 
    margin-bottom: 12px; 
    border-bottom: 1px solid #F3F4F6;
    max-width: 100%;
  }
   
  .selection-box { display: flex; align-items: center; justify-content: center; padding-right: 4px; }
   
  .expense-main-info { overflow: hidden; min-width: 0; }
  .expense-date-display { display: block; font-size: 12px; font-weight: 600; color: #6B7280; margin-bottom: 4px; }
  .expense-desc-title { 
    font-size: 16px; 
    font-weight: 700; 
    color: #111827; 
    margin: 0; 
    white-space: nowrap; 
    overflow: hidden; 
    text-overflow: ellipsis; 
  }

  .expense-amount-display { font-size: 18px; font-weight: 800; color: #111827; white-space: nowrap; }
   
  .nav-icon { color: #9CA3AF; flex-shrink: 0; }

  .card-stats { display: flex; align-items: center; max-width: 100%; overflow-x: auto; }
  .stat-badge-container { display: flex; gap: 8px; flex-wrap: wrap; }
   
  .category-badge { 
    font-size: 12px; 
    font-weight: 600; 
    padding: 4px 10px; 
    border-radius: 100px; 
    text-transform: capitalize; 
    border: 1px solid; 
    display: inline-flex; 
    align-items: center;
    white-space: nowrap;
  }
  
  .source-badge { 
    font-size: 11px; 
    font-weight: 700; 
    color: #3B82F6; 
    background: #EFF6FF; 
    padding: 4px 8px; 
    border-radius: 6px; 
    text-transform: uppercase; 
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .empty-state { text-align: center; padding: 40px; color: #6B7280; font-size: 15px; }

  /* Hide footer when selections are active - using body class */
  :global(body.has-selections .mobile-footer),
  :global(body.has-selections footer),
  :global(body.has-selections nav[class*="mobile"]),
  :global(body.has-selections .bottom-nav) {
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* ACTION BAR STYLES - REPLACES FOOTER ON MOBILE */
.action-bar-container { 
  position: fixed; 
  bottom: 0;
  left: 0; 
  right: 0; 
  display: flex; 
  justify-content: center; 
  z-index: 1000;
  padding: 0;
  animation: slideUpFade 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

.action-bar { 
  background: white;
  padding: 12px 16px;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
  max-width: 100%;
  width: 100%;
  pointer-events: auto;
  border-top: 1px solid #E5E7EB;
}

  .action-bar-left {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .selection-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #FF7F50;
    font-weight: 700;
    font-size: 13px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%);
    border-radius: 10px;
    border: 1px solid #FED7AA;
  }

  .selection-indicator svg {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
  }

  .selected-count { 
    color: #C2410C;
    white-space: nowrap;
  }

  .action-bar-right { 
    display: flex; 
    gap: 6px;
    justify-content: center;
  }

  .action-pill { 
    border: 2px solid transparent;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: inherit;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }

  .action-pill svg {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
  }

  /* Hide text on very small screens */
  .action-text {
    display: none;
  }

  .action-pill.secondary { 
    background: white;
    color: #6B7280;
    border-color: #E5E7EB;
  }

  .action-pill.export { 
    background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%);
    color: #C2410C;
    border-color: #FED7AA;
  }

  .action-pill.danger { 
    background: linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%);
    color: #DC2626;
    border-color: #FCA5A5;
  }

  .action-pill:active {
    transform: scale(0.95);
  }

  @media (hover: hover) {
    .action-pill.secondary:hover { 
      background: #F9FAFB;
      border-color: #D1D5DB;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .action-pill.export:hover { 
      background: linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%);
      border-color: #FDBA74;
      box-shadow: 0 2px 4px rgba(251,146,60,0.15);
    }
    
    .action-pill.danger:hover { 
      background: linear-gradient(135deg, #FECACA 0%, #FCA5A5 100%);
      border-color: #F87171;
      box-shadow: 0 2px 4px rgba(220,38,38,0.15);
    }
  }

  @keyframes slideUpFade { 
    from { 
      transform: translateY(100%);
      opacity: 0;
    } 
    to { 
      transform: translateY(0);
      opacity: 1;
    } 
  }

  /* Show text on slightly larger mobile screens */
  @media (min-width: 380px) {
    .action-text {
      display: inline;
    }
    
    .action-pill {
      padding: 10px 14px;
    }
  }

@media (min-width: 640px) {
  .action-bar-container {
    bottom: 30px;
    padding: 0 16px;
  }
  
  .action-bar { 
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    max-width: 700px;
    width: auto; /* CHANGED: from inheriting 100% to auto */
    gap: 16px;
    border-radius: 16px;
    border: 1px solid #E5E7EB;
    box-shadow: 
      0 0 0 1px rgba(0,0,0,0.05),
      0 10px 25px -5px rgba(0,0,0,0.1),
      0 8px 10px -6px rgba(0,0,0,0.1);
  }
  
  .action-bar-left {
    justify-content: flex-start;
  }
  
  .selection-indicator {
    font-size: 14px;
    padding: 8px 14px;
  }
  
  .action-bar-right {
    gap: 8px;
  }
  
  .action-pill {
    flex: 0 0 auto;
    min-width: auto;
    padding: 10px 18px;
    font-size: 14px;
  }
  
  .action-text {
    display: inline;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .action-bar {
    max-width: 800px;
    padding: 16px 24px;
  }
  
  .selection-indicator {
    font-size: 15px;
    padding: 8px 16px;
  }
  
  .action-pill {
    padding: 12px 24px;
    font-size: 15px;
  }
}

  /* Categories Manager Modal Styles */
  .categories-manager { padding: 4px; }
  .cat-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; }
  .cat-item { display: flex; align-items: center; gap: 4px; background: #F3F4F6; padding: 4px 4px 4px 10px; 
    border-radius: 20px; border: 1px solid #E5E7EB; }
  .cat-badge { font-size: 13px; font-weight: 500; text-transform: capitalize; padding: 0 4px; 
    border: none; background: transparent; }
  .cat-delete { border: none; background: #E5E7EB; color: #6B7280; border-radius: 50%; width: 24px; height: 24px; 
    display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }

  .add-cat-form { display: flex; gap: 8px; }
  .add-cat-form .input-field { flex: 1; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  .add-cat-form .btn-secondary { padding: 10px 16px; }
  .modal-actions .btn-cancel { background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; 
    border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; }

  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .hidden-mobile { display: block; }
  }
  
  @media (max-width: 639px) {
    .hidden-mobile { display: none; }
  }
</style>