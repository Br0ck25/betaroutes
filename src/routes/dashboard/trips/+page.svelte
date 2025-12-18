<script lang="ts">
  import { trips, isLoading } from '$lib/stores/trips';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import { toasts } from '$lib/stores/toast';
  import { userSettings } from '$lib/stores/userSettings';
  import Modal from '$lib/components/ui/Modal.svelte';

  // [!code fix] BRIDGE: Server Stream -> Client Store
  // This listens for the streamed promise and updates your existing store
  export let data;
  $: if (data.streamed?.tripsPromise) {
      trips.setLoading(true); // Show skeletons immediately
      
      data.streamed.tripsPromise
          .then((loadedTrips: any[]) => {
              trips.set(loadedTrips);
              trips.setLoading(false); // Hide skeletons when done
          })
          .catch((err: any) => {
              console.error("Failed to stream trips", err);
              trips.setLoading(false);
              toasts.error("Failed to load trips.");
          });
  }

  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterProfit = 'all'; 
  let startDate = '';
  let endDate = '';

  // --- PAGINATION STATE ---
  let currentPage = 1;
  const itemsPerPage = 20;
  // --- SELECTION STATE ---
  let selectedTrips = new Set<string>();
  
  // --- MODAL STATE (Category Management) ---
  let isManageCategoriesOpen = false;
  let activeCategoryType: 'maintenance' | 'supplies' = 'maintenance';
  let newCategoryName = '';

  $: activeCategories = activeCategoryType === 'maintenance' 
      ? ($userSettings.maintenanceCategories || ['oil change', 'repair'])
      : ($userSettings.supplyCategories || ['water', 'snacks']);

  // Reset selection and page when filters change
  $: if (searchQuery || sortBy || sortOrder || filterProfit || startDate || endDate) {
      currentPage = 1;
  }

  // Derived: All filtered results (for metrics/export)
  $: allFilteredTrips = $trips
    .filter(trip => {
      const query = searchQuery.toLowerCase();
      
      // Enhanced Search Logic
      const supplies = trip.supplyItems || trip.suppliesItems || [];
      const matchesSearch = !query || 
        // 1. Basic Text Fields
        trip.date?.includes(query) ||
        trip.startAddress?.toLowerCase().includes(query) ||
        trip.endAddress?.toLowerCase().includes(query) ||
        trip.notes?.toLowerCase().includes(query) ||
        
        // 2. Numeric Fields
        trip.totalMiles?.toString().includes(query) ||
        trip.fuelCost?.toString().includes(query) ||
        
        // 3. Stops (Address & Earnings)
        trip.stops?.some(stop => 
            stop.address?.toLowerCase().includes(query) || 
            stop.earnings?.toString().includes(query)
        ) ||

        // 4. Expenses (Maintenance & Supplies)
        trip.maintenanceItems?.some(item => 
            item.type?.toLowerCase().includes(query) || 
            item.cost?.toString().includes(query)
        ) ||
        supplies.some(item => 
            item.type?.toLowerCase().includes(query) || 
            item.cost?.toString().includes(query)
        );
      
      if (!matchesSearch) return false;
      
      if (filterProfit !== 'all') {
        const earnings = trip.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
        const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
        const profit = earnings - costs;
        if (filterProfit === 'positive' && profit <= 0) return false;
        if (filterProfit === 'negative' && profit >= 0) return false;
      }

      if (trip.date) {
        const tripDate = new Date(trip.date);
        tripDate.setHours(0, 0, 0, 0);
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (tripDate < start) return false;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(0, 0, 0, 0);
            if (tripDate > end) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'date':
          aVal = new Date(a.date || 0).getTime();
          bVal = new Date(b.date || 0).getTime();
          break;
        case 'profit':
          const aEarnings = a.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
          const aCosts = (a.fuelCost || 0) + (a.maintenanceCost || 0) + (a.suppliesCost || 0);
          const bEarnings = b.stops?.reduce((sum, stop) => sum + (stop.earnings || 0), 0) || 0;
          const bCosts = (b.fuelCost || 0) + (b.maintenanceCost || 0) + (b.suppliesCost || 0);
          aVal = aEarnings - aCosts;
          bVal = bEarnings - bCosts;
          break;
        case 'miles':
          aVal = a.totalMiles || 0;
          bVal = b.totalMiles || 0;
          break;
        default: return 0;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

  $: totalPages = Math.ceil(allFilteredTrips.length / itemsPerPage);
  $: visibleTrips = allFilteredTrips.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  $: allSelected = allFilteredTrips.length > 0 && selectedTrips.size === allFilteredTrips.length;

  function toggleSelection(id: string) {
      if (selectedTrips.has(id)) {
          selectedTrips.delete(id);
      } else {
          selectedTrips.add(id);
      }
      selectedTrips = selectedTrips; 
  }

  function toggleSelectAll() {
      if (allSelected) {
          selectedTrips = new Set();
      } else {
          selectedTrips = new Set(allFilteredTrips.map(t => t.id));
      }
  }

  function changePage(newPage: number) {
      if (newPage >= 1 && newPage <= totalPages) {
          currentPage = newPage;
          window.scrollTo({ top: 0, behavior: 'smooth' });
      }
  }

  // --- CATEGORY MANAGEMENT LOGIC ---
  async function updateCategories(newCategories: string[]) {
      const updateData: any = {};
      if (activeCategoryType === 'maintenance') {
          userSettings.update(s => ({ ...s, maintenanceCategories: newCategories }));
          updateData.maintenanceCategories = newCategories;
      } else {
          userSettings.update(s => ({ ...s, supplyCategories: newCategories }));
          updateData.supplyCategories = newCategories;
      }

      try {
          await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData)
          });
      } catch (e) {
          console.error('Failed to sync settings', e);
          toasts.error('Saved locally, but sync failed');
      }
  }

  async function addCategory() {
      if (!newCategoryName.trim()) return;
      const val = newCategoryName.trim().toLowerCase();
      if (activeCategories.includes(val)) {
          toasts.error('Category already exists');
          return;
      }
      const updated = [...activeCategories, val];
      await updateCategories(updated);
      newCategoryName = '';
      toasts.success('Category added');
  }

  async function removeCategory(cat: string) {
      if (!confirm(`Delete "${cat}" category?`)) return;
      const updated = activeCategories.filter(c => c !== cat);
      await updateCategories(updated);
      toasts.success('Category removed');
  }

  async function deleteSelected() {
      const count = selectedTrips.size;
      if (!confirm(`Are you sure you want to delete ${count} trip(s)?`)) return;

      const currentUser = $page.data.user || $user;
      let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id') || '';
      if (!userId) {
          toasts.error('User identity missing. Cannot delete.');
          return;
      }

      let successCount = 0;
      const ids = Array.from(selectedTrips);
      for (const id of ids) {
          try {
              await trips.deleteTrip(id, userId);
              successCount++;
          } catch (err) {
              console.error(`Failed to delete trip ${id}`, err);
          }
      }

      toasts.success(`Moved ${successCount} trips to trash.`);
      selectedTrips = new Set();
  }

  function exportSelected() {
      const selectedData = allFilteredTrips.filter(t => selectedTrips.has(t.id));
      if (selectedData.length === 0) return;

      const headers = ['Date', 'Start', 'End', 'Miles', 'Profit', 'Notes'];
      const rows = selectedData.map(t => {
          const profit = calculateNetProfit(t);
          return [
              t.date,
              `"${t.startAddress}"`,
              `"${t.endAddress}"`,
              t.totalMiles,
              profit.toFixed(2),
              `"${(t.notes || '').replace(/"/g, '""')}"`
          ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trips_export_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      
      toasts.success(`Exported ${selectedData.length} trips.`);
      selectedTrips = new Set();
  }

  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2
    }).format(amount);
  }
  
  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      timeZone: 'UTC' 
    }).format(date);
  }

  function formatTime(time: string): string {
    if (!time) return '';
    if (time.toLowerCase().includes('am') || time.toLowerCase().includes('pm')) {
      return time;
    }
    const [h, m] = time.split(':').map(Number);
    if (isNaN(h)) return time;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const mStr = !isNaN(m) ? m.toString().padStart(2, '0') : '00';
    return `${h12}:${mStr} ${ampm}`;
  }

  function formatDuration(minutes: number): string {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  
  async function deleteTrip(id: string, skipConfirm = false) {
    if (skipConfirm || confirm('Move trip to trash?')) {
      try {
        const trip = $trips.find(t => t.id === id);
        const currentUser = $page.data.user || $user;
        let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id') || '';
        if (trip && currentUser) {
            if (trip.userId === currentUser.name) userId = currentUser.name;
            else if (trip.userId === currentUser.token) userId = currentUser.token;
        }
        
        if (userId) await trips.deleteTrip(id, userId);
      } catch (err) {
        if (!skipConfirm) toasts.error('Failed to delete trip. Changes reverted.');
      }
    }
  }

  async function deleteAllTrips() {
      if (!confirm('WARNING: Are you sure you want to delete ALL trips? This cannot be undone.')) return;
      const tripsToDelete = [...$trips];
      for (const trip of tripsToDelete) {
          await deleteTrip(trip.id, true);
      }
  }
  
  function editTrip(id: string) {
    goto(`/dashboard/trips/edit/${id}`);
  }
  
  function calculateNetProfit(trip: any): number {
    const earnings = trip.stops?.reduce((s: number, stop: any) => s + (stop.earnings || 0), 0) || 0;
    const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
    return earnings - costs;
  }

  function calculateHourlyPay(trip: any): number {
    const profit = calculateNetProfit(trip);
    const hours = trip.hoursWorked || 0;
    return hours > 0 ? profit / hours : 0;
  }
  
  let expandedTrips = new Set<string>();
  function toggleExpand(id: string) {
    if (expandedTrips.has(id)) expandedTrips.delete(id);
    else expandedTrips.add(id);
    expandedTrips = expandedTrips;
  }

  function handleKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand(id);
    }
  }

  // Deep Link Handling
  let deepLinkHandled = false;
  $: if (!$isLoading && allFilteredTrips.length > 0 && !deepLinkHandled) {
      const id = $page.url.searchParams.get('id');
      if (id) {
          const index = allFilteredTrips.findIndex(t => t.id === id);
          if (index !== -1) {
              currentPage = Math.floor(index / itemsPerPage) + 1;
              expandedTrips.add(id);
              expandedTrips = expandedTrips;
              setTimeout(() => {
                  const element = document.getElementById('trip-' + id);
                  if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      element.classList.add('highlight-pulse');
                  }
              }, 200);
          }
      }
      deepLinkHandled = true;
  }

  // Swipe Action
  function swipeable(node: HTMLElement, { onEdit, onDelete }: { onEdit: () => void, onDelete: () => void }) {
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
        if (x < -80) {
            onDelete();
        } else if (x > 80) {
            onEdit();
        }
        node.style.transform = 'translateX(0)';
    }

    function handleClick(e: MouseEvent) {
        if (Math.abs(x) > 10) {
            e.stopPropagation();
            e.preventDefault();
        }
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: false });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd);
    node.addEventListener('click', handleClick, { capture: true });
    return {
        destroy() {
            node.removeEventListener('touchstart', handleTouchStart);
            node.removeEventListener('touchmove', handleTouchMove);
            node.removeEventListener('touchend', handleTouchEnd);
            node.removeEventListener('click', handleClick);
        }
    }
  }
</script>

{#if $isLoading}
    <div class="trip-list-cards">
      {#each Array(3) as _}
        <div class="trip-card">
          <div class="card-top">
            <div style="flex: 1">
              <Skeleton height="16px" width="30%" className="mb-2" />
              <Skeleton height="20px" width="60%" />
            </div>
            <Skeleton height="24px" width="60px" />
          </div>
          <div class="card-stats">
            {#each Array(5) as _}
              <div class="stat-item">
                 <Skeleton height="10px" width="40px" className="mb-1" />
                 <Skeleton height="14px" width="30px" />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
{/if}

<svelte:head>
  <title>Trip History - Go Route Yourself</title>
</svelte:head>

<div class="trip-history">
  <div class="page-header">
    <div class="header-text">
      <h1 class="page-title">Trip History</h1>
      <p class="page-subtitle">View and manage all your trips</p>
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

        <a href="/dashboard/trips/new" class="btn-primary" aria-label="Create New Trip">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          New Trip
        </a>
    </div>
  </div>
  
  <div class="stats-summary">
    <div class="summary-card">
      <div class="summary-label">Total Trips</div>
      <div class="summary-value">{allFilteredTrips.length}</div>
    </div>
    
    <div class="summary-card">
      <div class="summary-label">Total Miles</div>
      <div class="summary-value">
        {allFilteredTrips.reduce((sum, trip) => sum + (trip.totalMiles || 0), 0).toFixed(1)}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Profit</div>
      <div class="summary-value">
        {formatCurrency(allFilteredTrips.reduce((sum, trip) => sum + calculateNetProfit(trip), 0))}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Avg $/Hour</div>
      <div class="summary-value">
        {(() => {
          const tripsWithHours = allFilteredTrips.filter(t => t.hoursWorked > 0);
          if (tripsWithHours.length === 0) return 'N/A';
          const totalHourlyPay = tripsWithHours.reduce((sum, trip) => sum + calculateHourlyPay(trip), 0);
          return formatCurrency(totalHourlyPay / tripsWithHours.length) + '/hr';
        })()}
      </div>
    </div>
  </div>

  <div class="filters-bar sticky-bar">
    <div class="search-box">
      <svg class="search-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 19L14.65 14.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input type="text" placeholder="Search trips..." bind:value={searchQuery} aria-label="Search trips" />
    </div>
    
    <div class="filter-group date-group">
        <input type="date" bind:value={startDate} class="date-input" aria-label="Start Date" />
        <span class="date-sep">-</span>
        <input type="date" bind:value={endDate} class="date-input" aria-label="End Date" />
    </div>
    
    <div class="filter-group">
      <select bind:value={filterProfit} class="filter-select" aria-label="Filter by profit">
        <option value="all">All Trips</option>
        <option value="positive">Profitable</option>
        <option value="negative">Losses</option>
      </select>
      
      <select bind:value={sortBy} class="filter-select" aria-label="Sort by">
        <option value="date">By Date</option>
        <option value="profit">By Profit</option>
        <option value="miles">By Miles</option>
      </select>
      
      <button class="sort-btn" aria-label="Toggle sort order" on:click={() => sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})" aria-hidden="true">
            <path d="M10 3V17M10 17L4 11M10 17L16 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
  
  {#if visibleTrips.length > 0}
    <div class="batch-header" class:visible={allFilteredTrips.length > 0}>
        <label class="checkbox-container">
            <input type="checkbox" checked={allSelected} on:change={toggleSelectAll} />
            <span class="checkmark"></span>
            Select All ({allFilteredTrips.length})
        </label>
        
        <span class="page-info">Showing {visibleTrips.length} of {allFilteredTrips.length}</span>
    </div>

    <div class="trip-list-cards">
      {#each visibleTrips as trip (trip.id)}
        {@const profit = calculateNetProfit(trip)}
        {@const hourlyPay = calculateHourlyPay(trip)}
        {@const isExpanded = expandedTrips.has(trip.id)}
        {@const totalCosts = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0)}
        {@const isSelected = selectedTrips.has(trip.id)}
        {@const supplies = trip.supplyItems || trip.suppliesItems || []}
        
        <div class="trip-card-wrapper">
            <div class="swipe-bg">
                <div class="swipe-action edit"><span>Edit</span></div>
                <div class="swipe-action delete"><span>Delete</span></div>
            </div>

            <div 
              class="trip-card" 
              id={'trip-' + trip.id}
              class:expanded={isExpanded} 
              class:selected={isSelected}
              on:click={() => toggleExpand(trip.id)}
              on:keydown={(e) => handleKeydown(e, trip.id)}
              role="button"
              tabindex="0"
              aria-expanded={isExpanded}
              use:swipeable={{
                  onEdit: () => editTrip(trip.id),
                  onDelete: () => deleteTrip(trip.id)
              }}
            >
              <div class="card-top">
                 <div class="selection-box" on:click|stopPropagation on:keydown|stopPropagation role="none">
                    <label class="checkbox-container">
                        <input type="checkbox" checked={isSelected} on:change={() => toggleSelection(trip.id)} />
                        <span class="checkmark"></span>
                    </label>
                </div>

                <div class="trip-route-date">
                  <span class="trip-date-display">
                      {formatDate(trip.date || '')}
                      {#if trip.startTime}
                         <span class="time-range">• {formatTime(trip.startTime)} - {formatTime(trip.endTime || '17:00')}</span>
                      {/if}
                  </span>
                  <h3 class="trip-route-title">
                    {trip.startAddress?.split(',')[0] || 'Unknown'} 
                    {#if trip.stops && trip.stops.length > 0}
                      → {trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Stop'}
                    {/if}
                  </h3>
                </div>
                
                <div class="profit-display-large" class:positive={profit >= 0} class:negative={profit < 0}>
                    {formatCurrency(profit)}
                </div>
                
                <svg class="expand-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M6 15L10 11L14 15M14 5L10 9L6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>

              <div class="card-stats">
                <div class="stat-item">
                  <span class="stat-label">Miles</span>
                  <span class="stat-value">{trip.totalMiles?.toFixed(1) || '0.0'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Stops</span>
                  <span class="stat-value">{trip.stops?.length || 0}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Hours</span>
                  <span class="stat-value">{trip.hoursWorked?.toFixed(1) || '-'}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Drive</span>
                  <span class="stat-value">{formatDuration(trip.estimatedTime)}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">$/Hr</span>
                  <span class="stat-value hourly-pay">{trip.hoursWorked > 0 ? formatCurrency(hourlyPay) : '-'}</span>
                </div>
              </div>
              
              {#if isExpanded}
                <div class="expanded-details" on:click|stopPropagation on:keydown|stopPropagation role="group">
                  <div class="detail-section">
                    <h4 class="section-heading">Stops & Addresses</h4>
                    <div class="address-list">
                        <p><strong>Start:</strong> {trip.startAddress}</p>
                        {#if trip.stops}
                            {#each trip.stops as stop, i}
                              <p><strong>Stop {i + 1}:</strong> {stop.address}</p>
                          {/each}
                        {/if}
                        {#if trip.endAddress && trip.endAddress !== trip.startAddress}
                            <p><strong>End:</strong> {trip.endAddress}</p>
                        {/if}
                    </div>
                  </div>

                  {#if totalCosts > 0}
                    <div class="detail-section">
                      <h4 class="section-heading">Expenses & Costs</h4>
                      <div class="expense-list">
                        {#if trip.fuelCost > 0}
                          <div class="expense-row">
                            <span>Fuel</span>
                            <span>{formatCurrency(trip.fuelCost)}</span>
                          </div>
                        {/if}
                        {#if trip.maintenanceItems}
                           {#each trip.maintenanceItems as item}
                            <div class="expense-row">
                              <span>{item.type}</span>
                              <span>{formatCurrency(item.cost)}</span>
                            </div>
                          {/each}
                        {/if}
                        {#if supplies.length > 0}
                          {#each supplies as item}
                            <div class="expense-row">
                              <span>{item.type}</span>
                              <span>{formatCurrency(item.cost)}</span>
                            </div>
                           {/each}
                        {/if}
                        <div class="expense-row total">
                          <span>Total Costs</span>
                          <span>{formatCurrency(totalCosts)}</span>
                        </div>
                      </div>
                    </div>
                  {/if}

                  {#if trip.notes}
                    <div class="detail-section">
                      <h4 class="section-heading">Notes</h4>
                      <p class="trip-notes">{trip.notes}</p>
                    </div>
                  {/if}
                  
                  <div class="action-buttons-footer">
                    <button class="action-btn-lg edit-btn" on:click={() => editTrip(trip.id)}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Edit
                    </button>
                    <button class="action-btn-lg delete-btn" on:click={() => deleteTrip(trip.id)}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M12 4V13C12 13.5304 11.7893 14.0391 11.4142 14.4142C11.0391 14.7893 10.5304 15 10 15H6C5.46957 15 4.96086 14.7893 4.58579 14.4142C4.21071 14.0391 4 13.5304 4 13V4M5 4V3C5 2.46957 5.21071 1.96086 5.58579 1.58579C5.96086 1.21071 6.46957 1 7 1H9C9.53043 1 10.0391 1.21071 10.4142 1.58579C10.7893 1.96086 11 2.46957 11 3V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Trash
                    </button>
                  </div>
                </div>
              {/if}
            </div>
        </div>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="pagination-controls">
          <button class="page-btn" disabled={currentPage === 1} on:click={() => changePage(currentPage - 1)}>
            &larr; Prev
          </button>
          <span class="page-status">Page {currentPage} of {totalPages}</span>
          <button class="page-btn" disabled={currentPage === totalPages} on:click={() => changePage(currentPage + 1)}>
            Next &rarr;
          </button>
      </div>
    {/if}

  {:else}
    <div class="empty-state">
      <p>No trips found matching your filters.</p>
    </div>
  {/if}
</div>

{#if selectedTrips.size > 0}
    <div class="action-bar-container">
        <div class="action-bar">
            <span class="selected-count">{selectedTrips.size} Selected</span>
            <div class="action-buttons">
                <button class="action-pill secondary" on:click={() => selectedTrips = new Set()}>Cancel</button>
                <button class="action-pill export" on:click={exportSelected}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12V14H14V12M8 2V10M8 10L4 6M8 10L12 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Export CSV
                </button>
                <button class="action-pill danger" on:click={deleteSelected}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4H14M5 4V3C5 2.4 5.4 2 6 2H10C10.6 2 11 2.4 11 3V4M6 8V12M10 8V12" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Delete
                </button>
            </div>
        </div>
    </div>
{/if}

<Modal bind:open={isManageCategoriesOpen} title="Manage Categories">
    <div class="categories-manager">
        <div class="tabs">
            <button 
                class="tab-btn" 
                class:active={activeCategoryType === 'maintenance'}
                on:click={() => activeCategoryType = 'maintenance'}
            >
                Maintenance
            </button>
            <button 
                class="tab-btn" 
                class:active={activeCategoryType === 'supplies'}
                on:click={() => activeCategoryType = 'supplies'}
            >
                Supplies
            </button>
        </div>

        <p class="text-sm text-gray-500 mb-4">
            Add or remove categories for {activeCategoryType}.
        </p>
        
        <div class="cat-list">
            {#each activeCategories as cat}
                <div class="cat-item">
                    <span class="cat-badge">{cat}</span>
                    <button class="cat-delete" on:click={() => removeCategory(cat)} aria-label="Delete Category">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            {:else}
                <div class="text-sm text-gray-400 italic text-center py-4">No categories defined.</div>
            {/each}
        </div>

        <div class="add-cat-form">
            <input 
                type="text" 
                bind:value={newCategoryName} 
                placeholder="New {activeCategoryType} category..." 
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
  /* ... (Keep existing styles) ... */
  .trip-history { max-width: 1200px; margin: 0 auto; padding: 12px; padding-bottom: 80px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .header-actions { display: flex; gap: 8px; align-items: center; }
  
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; 
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; 
    border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; 
    box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); transition: transform 0.1s; }
  .btn-primary:active { transform: translateY(1px); }

  .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px; 
    background: white; border: 1px solid #E5E7EB; color: #374151; border-radius: 8px; 
    font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; }

  /* UPDATED: Wrap hover states in media query to prevent sticky hover on mobile */
  @media (hover: hover) {
    .btn-secondary:hover { background: #F9FAFB; }
    .cat-delete:hover { background: #EF4444; color: white; }
    .action-pill.secondary:hover { background: #4B5563; }
    .action-pill.export:hover { background: #F3F4F6; }
    .action-pill.danger:hover { background: #DC2626; }
    .page-btn:hover:not(:disabled) { border-color: #FF7F50; color: #FF7F50; }
  }

  /* Modal Styles */
  .categories-manager { padding: 4px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #E5E7EB; }
  .tab-btn { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; 
      font-weight: 600; color: #6B7280; cursor: pointer; transition: all 0.2s; }
  .tab-btn.active { color: #FF7F50; border-bottom-color: #FF7F50; }
  
  .cat-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; }
  .cat-item { display: flex; align-items: center; gap: 4px; background: #F3F4F6; padding: 4px 4px 4px 10px; 
    border-radius: 20px; border: 1px solid #E5E7EB; }
  .cat-badge { font-size: 13px; font-weight: 500; text-transform: capitalize; padding: 0 4px; }
  .cat-delete { border: none; background: #E5E7EB; color: #6B7280; border-radius: 50%; width: 24px; height: 24px; 
    display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
  
  .add-cat-form { display: flex; gap: 8px; }
  .add-cat-form .input-field { flex: 1; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  .modal-actions .btn-cancel { background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; 
    border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; }

  /* ... (Keep existing styles below) ... */
  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }
  .filters-bar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .sticky-bar { position: sticky; top: 0; z-index: 10; background: #F9FAFB; padding: 10px 12px; margin: -12px -12px 10px -12px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
  .search-box { position: relative; width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { width: 100%; padding: 12px 16px 12px 42px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  .date-group { display: flex; gap: 8px; align-items: center; }
  .date-input { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; min-width: 0; }
  .date-sep { color: #9CA3AF; font-weight: bold; }
  .filter-group { display: flex; flex-direction: row; gap: 8px; width: 100%; }
  .filter-select { flex: 1; min-width: 0; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; }
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; }
  .batch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px; color: #6B7280; font-size: 13px; font-weight: 500; }
  .checkbox-container { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; color: #4B5563; position: relative; padding-left: 28px; user-select: none; }
  .checkbox-container input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
  .checkmark { position: absolute; top: 0; left: 0; height: 20px; width: 20px; background-color: white; border: 2px solid #D1D5DB; border-radius: 6px; transition: all 0.2s; }
  .checkbox-container:hover input ~ .checkmark { border-color: #9CA3AF; }
  .checkbox-container input:checked ~ .checkmark { background-color: #FF7F50; border-color: #FF7F50; }
  .checkmark:after { content: ""; position: absolute; display: none; }
  .checkbox-container input:checked ~ .checkmark:after { display: block; }
  .checkbox-container .checkmark:after { left: 6px; top: 2px; width: 5px; height: 10px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }
  .trip-list-cards { display: flex; flex-direction: column; gap: 12px; }
  .trip-card-wrapper { position: relative; overflow: hidden; border-radius: 12px; background: #F3F4F6; }
  .swipe-bg { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; z-index: 0; }
  .swipe-action { font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .swipe-action.edit { color: #2563EB; }
  .swipe-action.delete { color: #DC2626; }
  .trip-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s; position: relative; z-index: 1; }
  .trip-card:active { background-color: #F9FAFB; }
  .trip-card.expanded { border-color: #FF7F50; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
  .trip-card.selected { background-color: #FFF7ED; border-color: #FF7F50; }
  @keyframes pulse-border { 0% { border-color: #FF7F50; box-shadow: 0 0 0 0 rgba(255, 127, 80, 0.4); } 70% { border-color: #FF7F50; box-shadow: 0 0 0 10px rgba(255, 127, 80, 0); } 100% { border-color: #E5E7EB; box-shadow: 0 0 0 0 rgba(255, 127, 80, 0); } }
  :global(.highlight-pulse) { animation: pulse-border 2s ease-out; }
  .card-top { display: grid; grid-template-columns: auto 1fr auto 20px; align-items: center; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .selection-box { display: flex; align-items: center; justify-content: center; }
  .trip-route-date { overflow: hidden; }
  .trip-date-display { display: block; font-size: 12px; font-weight: 600; color: #6B7280; margin-bottom: 4px; }
  .time-range { color: #4B5563; margin-left: 4px; font-weight: 500; }
  .trip-route-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profit-display-large { font-size: 18px; font-weight: 800; white-space: nowrap; }
  .profit-display-large.positive { color: #10B981; }
  .profit-display-large.negative { color: #DC2626; }
  .expand-icon { color: #9CA3AF; transition: transform 0.2s; }
  .trip-card.expanded .expand-icon { transform: rotate(180deg); }
  .card-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .stat-item { display: flex; flex-direction: column; align-items: center; }
  .stat-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; }
  .stat-value { font-size: 14px; font-weight: 600; color: #4B5563; }
  .hourly-pay { color: #059669; }
  .expanded-details { display: flex; flex-direction: column; gap: 16px; padding-top: 16px; border-top: 1px dashed #E5E7EB; margin-top: 16px; }
  .detail-section { background: #F9FAFB; padding: 12px; border-radius: 8px; }
  .section-heading { font-size: 13px; font-weight: 700; color: #1F2937; margin-bottom: 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
  .address-list p { font-size: 14px; color: #374151; margin: 4px 0; }
  .expense-list { display: flex; flex-direction: column; gap: 4px; }
  .expense-row { display: flex; justify-content: space-between; font-size: 13px; color: #4B5563; }
  .expense-row.total { border-top: 1px solid #E5E7EB; margin-top: 4px; padding-top: 4px; font-weight: 700; color: #111827; }
  .trip-notes { font-style: italic; font-size: 14px; color: #4B5563; line-height: 1.4; }
  .action-buttons-footer { display: flex; gap: 12px; }
  .action-btn-lg { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 8px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s; border: 2px solid; font-size: 14px; }
  .edit-btn { background: #EFF6FF; color: #2563EB; border-color: #2563EB; }
  .delete-btn { background: #FEF2F2; color: #DC2626; border-color: #DC2626; }
  .empty-state { text-align: center; padding: 40px 20px; color: #6B7280; font-size: 15px; }
  .action-bar-container { position: fixed; bottom: 20px; left: 0; right: 0; display: flex; justify-content: center; z-index: 50; padding: 0 16px; animation: slideUp 0.3s ease-out; }
  .action-bar { background: #1F2937; color: white; padding: 8px 16px; border-radius: 100px; display: flex; align-items: center; gap: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
  .selected-count { font-weight: 700; font-size: 14px; }
  .action-buttons { display: flex; gap: 8px; }
  .action-pill { border: none; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
  .action-pill.secondary { background: #374151; color: #E5E7EB; }
  .action-pill.export { background: #E5E7EB; color: #1F2937; }
  .action-pill.danger { background: #EF4444; color: white; }
  @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .pagination-controls { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 32px; }
  .page-btn { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; font-weight: 600; font-size: 14px; color: #374151; cursor: pointer; transition: all 0.2s; }
  .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .page-status { font-size: 14px; color: #4B5563; font-weight: 500; }

  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; justify-content: space-between; align-items: center; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; flex-wrap: nowrap; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(2, 1fr); }
    .card-stats { grid-template-columns: repeat(5, 1fr); }
  }
  @media (min-width: 1024px) {
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .search-box { max-width: 300px; }
  }
</style>