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

  // --- STATE ---
  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterCategory = 'all';
  let startDate = '';
  let endDate = '';

  // Use categories from settings, default to basic if empty
  $: categories = $userSettings.expenseCategories?.length > 0 
      ? $userSettings.expenseCategories 
      : ['maintenance', 'insurance', 'supplies', 'other'];

  // --- MODAL STATE ---
  let isModalOpen = false;
  let isManageCategoriesOpen = false;
  let editingId: string | null = null;
  let formData = {
    date: new Date().toISOString().split('T')[0],
    category: '',
    amount: '',
    description: ''
  };
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
              description: 'Fuel (Trip Log)', // [!code change] Matches other trip items
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

  // --- ACTIONS ---
  function openModal(existingItem: any = null) {
    if (existingItem?.source === 'trip') return; 

    if (existingItem) {
      editingId = existingItem.id;
      formData = {
        date: existingItem.date,
        category: existingItem.category,
        amount: existingItem.amount.toString(),
        description: existingItem.description || ''
      };
    } else {
      editingId = null;
      formData = {
        date: new Date().toISOString().split('T')[0],
        category: categories[0] || 'other',
        amount: '',
        description: ''
      };
    }
    isModalOpen = true;
  }

  async function saveExpense() {
    if (!formData.amount || !formData.date || !formData.category) {
      toasts.error('Please fill in required fields.');
      return;
    }

    const currentUser = $page.data.user || $user;
    const userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');

    if (!userId) {
      toasts.error('User not identified. Cannot save.');
      return;
    }

    try {
      const payload = {
        ...formData,
        amount: parseFloat(formData.amount)
      };

      if (editingId) {
        await expenses.updateExpense(editingId, payload, userId);
        toasts.success('Expense updated');
      } else {
        await expenses.create(payload, userId);
        toasts.success('Expense created');
      }
      isModalOpen = false;
    } catch (err) {
      console.error(err);
      toasts.error('Failed to save expense');
    }
  }

  async function deleteExpense(id: string) {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    
    const currentUser = $page.data.user || $user;
    const userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
    
    if (userId) {
      try {
        await expenses.deleteExpense(id, userId);
        toasts.success('Expense deleted');
      } catch (err) {
        console.error(err);
        toasts.error('Failed to delete');
      }
    }
  }

  function navigateToTrip(tripId: string) {
      goto(`/dashboard/trips?id=${tripId}`);
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
  function swipeable(node: HTMLElement, { onEdit, onDelete, isReadOnly }: { onEdit: () => void, onDelete: () => void, isReadOnly: boolean }) {
    if (isReadOnly) return;

    let startX = 0;
    let startY = 0;
    let x = 0;
    let swiping = false;

    function handleTouchStart(e: TouchEvent) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        x = 0;
        node.style.transition = 'none';
    }

    function handleTouchMove(e: TouchEvent) {
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) return;
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
        if (x < -80) onDelete();
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
        <button class="btn-secondary" on:click={() => isManageCategoriesOpen = true} aria-label="Manage Categories">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        
        <button class="btn-primary" on:click={() => openModal()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="hidden-mobile-text">Add Expense</span>
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
  
  {#if loading}
    <div class="list-cards">
      {#each Array(3) as _}
        <div class="expense-card">
            <Skeleton height="20px" width="40%" className="mb-2" />
            <Skeleton height="16px" width="70%" />
        </div>
      {/each}
    </div>
  {:else if filteredExpenses.length > 0}
    <div class="list-cards">
      {#each filteredExpenses as expense (expense.id)}
        <div class="card-wrapper">
            {#if expense.source !== 'trip'}
                <div class="swipe-bg">
                    <div class="swipe-action edit"><span>Edit</span></div>
                    <div class="swipe-action delete"><span>Delete</span></div>
                </div>
            {/if}

            <div 
                class="expense-card" 
                class:read-only={expense.source === 'trip'}
                use:swipeable={{
                    onEdit: () => openModal(expense),
                    onDelete: () => deleteExpense(expense.id),
                    isReadOnly: expense.source === 'trip'
                }}
            >
                <div class="expense-row-main">
                    <div class="expense-info">
                        <div class="expense-header">
                            <span class="expense-date">{formatDate(expense.date)}</span>
                            <span class={`category-badge ${getCategoryColor(expense.category)}`}>
                                {getCategoryLabel(expense.category)}
                            </span>
                            {#if expense.source === 'trip'}
                                <span class="source-badge">Trip Log</span>
                            {/if}
                        </div>
                        <div class="expense-desc">
                            {expense.description || 'No description'}
                        </div>
                    </div>
                    <div class="expense-amount">
                        {formatCurrency(expense.amount)}
                    </div>
                </div>

                <div class="expense-actions">
                    {#if expense.source === 'trip'}
                        <button class="icon-btn text-blue-600 bg-blue-50 hover:bg-blue-100" on:click={() => navigateToTrip(expense.tripId)} title="View Trip">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                        </button>
                    {:else}
                        <button class="icon-btn" on:click={() => openModal(expense)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="icon-btn danger" on:click={() => deleteExpense(expense.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </button>
                    {/if}
                </div>
            </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty-state">
      <p>No expenses found.</p>
    </div>
  {/if}
</div>

<Modal bind:open={isModalOpen} title={editingId ? 'Edit Expense' : 'New Expense'}>
    <div class="form-grid">
        <label class="form-group">
            <span class="label">Date</span>
            <input type="date" bind:value={formData.date} class="input-field" />
        </label>
        
        <label class="form-group">
            <span class="label">Category</span>
            <select bind:value={formData.category} class="input-field">
                {#if categories.length === 0}
                    <option value="" disabled>No categories available</option>
                {/if}
                {#each categories as cat}
                    <option value={cat}>{getCategoryLabel(cat)}</option>
                {/each}
            </select>
            {#if categories.length === 0}
                <div class="text-xs text-red-500 mt-1">Please add a category in Manage Categories.</div>
            {/if}
        </label>

        <label class="form-group">
            <span class="label">Amount ($)</span>
            <input type="number" step="0.01" bind:value={formData.amount} placeholder="0.00" class="input-field" />
        </label>

        <label class="form-group">
            <span class="label">Description</span>
            <input type="text" bind:value={formData.description} placeholder="e.g., Oil Change" class="input-field" />
        </label>

        <div class="modal-actions">
            <button class="btn-cancel" on:click={() => isModalOpen = false}>Cancel</button>
            <button class="btn-save" on:click={saveExpense}>Save Expense</button>
        </div>
    </div>
</Modal>

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
  .page-container { max-width: 1200px; margin: 0 auto; padding: 12px; padding-bottom: 80px; }

  /* Reused Styles */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .header-actions { display: flex; gap: 8px; }

  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; 
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; 
    border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; 
    box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); transition: transform 0.1s; }
  .btn-primary:active { transform: translateY(1px); }

  .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px; 
    background: white; border: 1px solid #E5E7EB; color: #374151; border-radius: 8px; 
    font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; }
  .btn-secondary:hover { background: #F9FAFB; }

  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }

  .filters-bar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .sticky-bar { position: sticky; top: 0; z-index: 10; background: #F9FAFB; padding: 10px 12px; margin: -12px -12px 10px -12px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }

  .search-box { position: relative; width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { width: 100%; padding: 12px 16px 12px 42px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  
  .date-group, .filter-group { display: flex; gap: 8px; align-items: center; }
  .filter-group { width: 100%; }
  .date-input, .filter-select { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; min-width: 0; }
  .date-sep { color: #9CA3AF; font-weight: bold; }
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; }

  /* Expense Card Styles */
  .list-cards { display: flex; flex-direction: column; gap: 12px; }
  .card-wrapper { position: relative; overflow: hidden; border-radius: 12px; background: #F3F4F6; }
  
  .swipe-bg { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; z-index: 0; }
  .swipe-action { font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .swipe-action.edit { color: #2563EB; }
  .swipe-action.delete { color: #DC2626; }

  .expense-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .expense-card.read-only { background: #FAFAFA; border-left: 4px solid #3B82F6; }
  
  .expense-row-main { flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .expense-info { display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
  .expense-header { display: flex; align-items: center; gap: 8px; }
  .expense-date { font-size: 12px; font-weight: 600; color: #6B7280; }
  
  .category-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 100px; text-transform: capitalize; border: 1px solid; }
  .source-badge { font-size: 10px; font-weight: 700; color: #3B82F6; background: #EFF6FF; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

  .expense-desc { font-size: 15px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .expense-amount { font-size: 16px; font-weight: 700; color: #111827; white-space: nowrap; }

  .expense-actions { display: flex; gap: 8px; }
  .icon-btn { padding: 8px; border-radius: 8px; color: #6B7280; background: #F3F4F6; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .icon-btn:hover { background: #E5E7EB; color: #111827; }
  .icon-btn.danger:hover { background: #FEF2F2; color: #DC2626; }

  .empty-state { text-align: center; padding: 40px; color: #6B7280; }

  /* Modal Form Styles */
  .form-grid { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 13px; font-weight: 600; color: #4B5563; }
  .input-field { padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 15px; width: 100%; box-sizing: border-box; }
  
  .modal-actions { display: flex; gap: 12px; margin-top: 8px; }
  .btn-save { flex: 1; background: #111827; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .btn-cancel { flex: 1; background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; }

  /* Categories Manager */
  .cat-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; }
  .cat-item { display: flex; align-items: center; gap: 4px; background: #F3F4F6; padding: 4px 4px 4px 10px; border-radius: 20px; border: 1px solid #E5E7EB; }
  .cat-badge { font-size: 13px; font-weight: 500; text-transform: capitalize; padding: 0 4px; border: none; background: transparent; }
  .cat-delete { border: none; background: #E5E7EB; color: #6B7280; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
  .cat-delete:hover { background: #EF4444; color: white; }

  .add-cat-form { display: flex; gap: 8px; }
  .add-cat-form .input-field { flex: 1; }
  .add-cat-form .btn-secondary { padding: 10px 16px; }

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
      .expense-actions { display: none; }
      .hidden-mobile-text { display: none; }
  }
</style>