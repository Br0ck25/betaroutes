<script lang="ts">
  import { trips, isLoading } from '$lib/stores/trips';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import AsyncErrorBoundary from '$lib/components/AsyncErrorBoundary.svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import { toasts } from '$lib/stores/toast';
  import { userSettings } from '$lib/stores/userSettings';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { autocomplete } from '$lib/utils/autocomplete';

  // Error boundary reference
  let tripsBoundary: any;
  let hasLoadedOnce = false;
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
  // --- MODAL & SETTINGS STATE ---
  let isSettingsOpen = false;
  // Unified settings modal
  let settingsTab: 'defaults' | 'categories' = 'defaults'; // Tab switcher
  let isUpgradeModalOpen = false;
  // Category State
  let activeCategoryType: 'maintenance' | 'supplies' = 'maintenance';
  let newCategoryName = '';
  // Defaults State
  let settings = { ...$userSettings };
  // Keep local settings in sync with store updates
  $: if ($userSettings) {
      settings = { ...$userSettings };
  }

  // Check Pro Status
  $: isPro = ['pro', 'business', 'premium', 'enterprise'].includes($user?.plan || '');
  // API Key for Autocomplete
  $: API_KEY = $page.data.googleMapsApiKey;
  $: activeCategories = activeCategoryType === 'maintenance' 
      ? ($userSettings.maintenanceCategories || ['oil change', 'repair'])
      : ($userSettings.supplyCategories || ['water', 'snacks']);
  // Reset selection and page when filters change
  $: if (searchQuery || sortBy || sortOrder || filterProfit || startDate || endDate) {
      currentPage = 1;
  }

  // --- SETTINGS LOGIC ---

let lastHadSelections = false;

$: if (typeof document !== 'undefined') {
  const hasSelections = selectedTrips.size > 0;
  if (hasSelections !== lastHadSelections) {
    if (hasSelections) {
      document.body.classList.add('has-selections');
    } else {
      document.body.classList.remove('has-selections');
    }
    lastHadSelections = hasSelections;
  }
}

  // Clean up body class when component is destroyed
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('has-selections');
    }
  });


  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const val = e.detail.formatted_address || e.detail.name;
    if (field === 'start') settings.defaultStartAddress = val;
    if (field === 'end') settings.defaultEndAddress = val;
  }

  async function saveDefaultSettings() {
    userSettings.set(settings);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: settings })
        });
        if (!res.ok) throw new Error('Failed to sync');
        toasts.success('Default values saved!');
    } catch (e) {
        console.error('Sync error:', e);
        toasts.error('Saved locally, but cloud sync failed');
    }
  }

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

  // --- LOADING LOGIC ---
  async function loadTrips() {
    try {
      if (!hasLoadedOnce) {
        tripsBoundary?.setLoading();
      }
      await trips.load();
      hasLoadedOnce = true;
      tripsBoundary?.setSuccess();
    } catch (error) {
      console.error('Failed to load trips:', error);
      tripsBoundary?.setError(error as Error);
      toasts.error('Failed to load trips. Click retry to try again.');
      throw error;
    }
  }

  onMount(() => {
    loadTrips();
  });
  // --- TRIP FILTERING & SORTING ---
  $: allFilteredTrips = $trips
    .filter(trip => {
      const query = searchQuery.toLowerCase();
      const supplies = trip.supplyItems || trip.suppliesItems || [];
      const matchesSearch = !query || 
        trip.date?.includes(query) ||
        trip.startAddress?.toLowerCase().includes(query) ||
        trip.endAddress?.toLowerCase().includes(query) ||
        trip.notes?.toLowerCase().includes(query) ||
        trip.totalMiles?.toString().includes(query) ||
        trip.fuelCost?.toString().includes(query) ||
        trip.stops?.some(stop => 
            stop.address?.toLowerCase().includes(query) || 
            stop.earnings?.toString().includes(query)
        ) ||
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
      if (selectedTrips.has(id)) selectedTrips.delete(id);
      else selectedTrips.add(id);
      selectedTrips = selectedTrips;
  }

  function toggleSelectAll() {
      if (allSelected) selectedTrips = new Set();
      else selectedTrips = new Set(allFilteredTrips.map(t => t.id));
  }

  function changePage(newPage: number) {
      if (newPage >= 1 && newPage <= totalPages) {
          currentPage = newPage;
          window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
      if (!isPro) {
        isUpgradeModalOpen = true;
        return;
      }

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

  function openGoogleMaps(e: MouseEvent, trip: any) {
    e.stopPropagation();
    const origin = encodeURIComponent(trip.startAddress || '');
    const destination = encodeURIComponent(trip.endAddress || trip.startAddress || '');
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (trip.stops && trip.stops.length > 0) {
        const waypoints = trip.stops
            .map((s: any) => encodeURIComponent(s.address || ''))
            .filter((a: string) => a.length > 0)
            .join('|');
        if (waypoints) {
            url += `&waypoints=${waypoints}`;
        }
    }
    window.open(url, '_blank');
  }

  function openMapToStop(e: MouseEvent, trip: any, stopIndex: number) {
    e.stopPropagation();
    const origin = encodeURIComponent(trip.startAddress || '');
    const targetStop = trip.stops[stopIndex];
    const destination = encodeURIComponent(targetStop.address || '');

    const previousStops = trip.stops.slice(0, stopIndex);
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (previousStops.length > 0) {
        const waypoints = previousStops
            .map((s: any) => encodeURIComponent(s.address || ''))
            .filter((a: string) => a.length > 0)
            .join('|');
        if (waypoints) {
            url += `&waypoints=${waypoints}`;
        }
    }
    window.open(url, '_blank');
  }

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

<svelte:head>
  <title>Trip History - Go Route Yourself</title>
  <style>
    .pac-container { z-index: 10000 !important; }
  </style>
</svelte:head>

<AsyncErrorBoundary bind:this={tripsBoundary} onRetry={loadTrips}>

<div class="trip-history">
  <div class="page-header">
    <div class="header-text">
      <h1 class="page-title">Trip History</h1>
      <p class="page-subtitle">View and manage all your trips</p>
    </div>
    
    <div class="header-actions">
        <button class="btn-secondary" onclick={() => goto('/dashboard/trash')} aria-label="View Trash">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        </button>

        <button class="btn-secondary" onclick={() => isSettingsOpen = true} aria-label="Trip Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
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
      
      <button class="sort-btn" aria-label="Toggle sort order" onclick={() => sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="transform: rotate({sortOrder === 'asc' ? '180deg' : '0deg'})" aria-hidden="true">
            <path d="M10 3V17M10 17L4 11M10 17L16 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
  
  {#if visibleTrips.length > 0}
    <div class="batch-header" class:visible={allFilteredTrips.length > 0}>
        <label class="checkbox-container">
            <input type="checkbox" checked={allSelected} onchange={toggleSelectAll} />
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
              onclick={() => toggleExpand(trip.id)}
              onkeydown={(e) => handleKeydown(e, trip.id)}
              role="button"
              tabindex="0"
              aria-expanded={isExpanded}
              use:swipeable={{
                  onEdit: () => editTrip(trip.id),
                  onDelete: () => deleteTrip(trip.id)
              }}
           >
              <div class="card-top">
                 <div class="selection-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="none">
                    <label class="checkbox-container">
                        <input type="checkbox" checked={isSelected} onchange={() => toggleSelection(trip.id)} />
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
      
                  <div class="trip-title-row">
                       <h3 class="trip-route-title">
                        {trip.startAddress?.split(',')[0] || 'Unknown'} 
                        {#if trip.stops && trip.stops.length > 0}
                          → {trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Stop'}
                        {/if}
                      </h3>
                      
                      <button 
                        class="map-link-btn" 
                        onclick={(e) => openGoogleMaps(e, trip)} 
                        title="View Route in Google Maps"
                        aria-label="View Route in Google Maps"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"></path>
                            <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"></path>
                        </svg>
                      </button>
                   </div>
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
                <div class="expanded-details" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="group">
                   <div class="detail-section">
                    <h4 class="section-heading">Stops & Addresses</h4>
                    <div class="address-list">
                        <div class="address-row">
                          <span class="address-text"><strong>Start:</strong> {trip.startAddress}</span>
                        </div>
                        {#if trip.stops}
                           {#each trip.stops as stop, i}
                               <div class="address-row">
                                  <span class="address-text"><strong>Stop {i + 1}:</strong> {stop.address}</span>
                                  <button 
                                    class="mini-map-btn" 
                                    onclick={(e) => openMapToStop(e, trip, i)}
                                    title="Map route from Start to here"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                         <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                                    </svg>
                                  </button>
                              </div>
                          {/each}
                       {/if}
            
                        {#if trip.endAddress && trip.endAddress !== trip.startAddress}
                             <div class="address-row">
                                <span class="address-text"><strong>End:</strong> {trip.endAddress}</span>
                                 <button 
                                    class="mini-map-btn" 
                                    onclick={(e) => openGoogleMaps(e, trip)}
                                    title="Map full route"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                                    </svg>
                                 </button>
                            </div>
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
                    <button class="action-btn-lg edit-btn" onclick={() => editTrip(trip.id)}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        Edit
                    </button>
                    <button class="action-btn-lg delete-btn" onclick={() => deleteTrip(trip.id)}>
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
           <button class="page-btn" disabled={currentPage === 1} onclick={() => changePage(currentPage - 1)}>
            ← Prev
          </button>
          <span class="page-status">Page {currentPage} of {totalPages}</span>
          <button class="page-btn" disabled={currentPage === totalPages} onclick={() => changePage(currentPage + 1)}>
            Next →
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
    <div class="action-bar-container" data-has-selections="true">
        <div class="action-bar">
            <div class="action-bar-left">
                <div class="selection-indicator">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span class="selected-count">{selectedTrips.size} {selectedTrips.size === 1 ? 'trip' : 'trips'} selected</span>
                </div>
            </div>
            
            <div class="action-bar-right">
                <button class="action-pill secondary" onclick={() => selectedTrips = new Set()}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    <span class="action-text">Cancel</span>
                </button>
                
                <button class="action-pill export" onclick={exportSelected}>
                    {#if !isPro}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    {:else}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    {/if}
                    <span class="action-text">Export</span>
                </button>
    
                <button class="action-pill danger" onclick={deleteSelected}>
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
            <Button variant="outline" onclick={() => isUpgradeModalOpen = false}>
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

{#snippet loading()}
  <div class="trips-loading">
    <div class="loading-header">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-button"></div>
    </div>
     
    <div class="loading-stats">
      {#each Array(4) as _}
        <div class="skeleton skeleton-stat"></div>
      {/each}
    </div>

    <div class="loading-filters">
       <div class="skeleton skeleton-input"></div>
      <div class="skeleton skeleton-select"></div>
    </div>

    <div class="trip-list-cards">
      {#each Array(6) as _}
        <div class="trip-skeleton">
          <div class="skeleton-top">
              <div class="skeleton skeleton-text" style="width: 30%; height: 14px;"></div>
            <div class="skeleton skeleton-text" style="width: 60%; height: 18px; margin-top: 8px;"></div>
          </div>
          <div class="skeleton-stats-grid">
            {#each Array(5) as _}
              <div>
                <div class="skeleton skeleton-text" style="width: 80%; height: 10px; margin-bottom: 4px;"></div>
                <div class="skeleton skeleton-text" style="width: 50%; height: 14px;"></div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet error({ error, retry })}
  <div class="trips-error">
    <div class="error-content">
      <div class="error-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>

      <h2>Failed to Load Trips</h2>
      
      <p class="error-message">
        {#if error.message.includes('fetch') || error.message.includes('Failed to fetch')}
          Unable to connect to the server. Please check your internet connection and try again.
        {:else if error.message.includes('401') || error.message.includes('Unauthorized')}
          Your session has expired. Please <a href="/login">log in again</a>.
        {:else if error.message.includes('403') || error.message.includes('Forbidden')}
          You don't have permission to view trips. Please contact support if this persists.
        {:else if error.message.includes('500')}
          A server error occurred. Our team has been notified. Please try again in a few moments.
        {:else}
          {error.message}
        {/if}
      </p>

      <div class="error-actions">
        <button onclick={retry} class="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
           </svg>
          Try Again
        </button>

        <a href="/dashboard" class="btn-secondary">
          Go to Dashboard
        </a>
      </div>

      <details class="error-details">
        <summary>Technical Details</summary>
        <pre><code>{JSON.stringify({
          message: error.message,
          time: new Date().toISOString(),
          path: $page.url.pathname,
          userAgent: navigator.userAgent
        }, null, 2)}</code></pre>
      </details>
    </div>
  </div>
{/snippet}

</AsyncErrorBoundary>

<Modal bind:open={isSettingsOpen} title="Trip Settings">
    <div class="settings-modal-content">
        <div class="top-tabs">
            <button 
                 class="top-tab-btn" 
                class:active={settingsTab === 'defaults'} 
                onclick={() => settingsTab = 'defaults'}
            >
                Default Values
            </button>
            <button 
                class="top-tab-btn" 
                class:active={settingsTab === 'categories'} 
                onclick={() => settingsTab = 'categories'}
            >
                Categories
            </button>
        </div>

        {#if settingsTab === 'defaults'}
            <div class="settings-form space-y-4">
                <p class="text-sm text-gray-500 mb-2">Pre-fill new trips with these values.</p>
                
                <div class="form-group">
                   <label for="default-mpg" class="block text-sm font-medium text-gray-700 mb-1">Default MPG</label>
                    <input id="default-mpg" type="number" bind:value={settings.defaultMPG} placeholder="25" min="1" step="0.1" class="w-full p-2 border rounded-lg" />
                </div>
                
                <div class="form-group">
                    <label for="default-gas" class="block text-sm font-medium text-gray-700 mb-1">Default Gas Price</label>
                    <div class="relative">
                        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input id="default-gas" type="number" bind:value={settings.defaultGasPrice} placeholder="3.50" min="0" step="0.01" class="w-full p-2 pl-7 border rounded-lg" />
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="default-start" class="block text-sm font-medium text-gray-700 mb-1">Default Start Address</label>
                    <input 
                        id="default-start"
                        type="text" 
                        bind:value={settings.defaultStartAddress}
                        placeholder="Start typing address..."
                        autocomplete="off"
                        use:autocomplete={{ apiKey: API_KEY }}
                        onplace-selected={(e) => handleAddressSelect('start', e)}
                        class="w-full p-2 border rounded-lg"
                    />
                </div>
                
                <div class="form-group">
                     <label for="default-end" class="block text-sm font-medium text-gray-700 mb-1">Default End Address</label>
                    <input 
                        id="default-end"
                        type="text" 
                        bind:value={settings.defaultEndAddress}
                        placeholder="Start typing address..."
                        autocomplete="off"
                        use:autocomplete={{ apiKey: API_KEY }}
                        onplace-selected={(e) => handleAddressSelect('end', e)}
                        class="w-full p-2 border rounded-lg"
                    />
                </div>
                
                 <div class="modal-actions pt-4">
                    <button class="btn-primary w-full" onclick={saveDefaultSettings}>Save Defaults</button>
                </div>
            </div>
        {/if}

        {#if settingsTab === 'categories'}
            <div class="categories-manager">
                <div class="tabs sub-tabs">
                    <button 
                        class="tab-btn" 
                        class:active={activeCategoryType === 'maintenance'}
                        onclick={() => activeCategoryType = 'maintenance'}
                    >
                        Maintenance
                    </button>
                    <button 
                        class="tab-btn" 
                        class:active={activeCategoryType === 'supplies'}
                        onclick={() => activeCategoryType = 'supplies'}
                    >
                        Supplies
                    </button>
                </div>

                <p class="text-sm text-gray-500 mb-4">
                   Manage {activeCategoryType} options.
                </p>
                
                <div class="cat-list">
                    {#each activeCategories as cat}
                        <div class="cat-item">
                             <span class="cat-badge">{cat}</span>
                            <button class="cat-delete" onclick={() => removeCategory(cat)} aria-label="Delete Category">
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
                        placeholder="New category..." 
                        class="input-field"
                        onkeydown={(e) => e.key === 'Enter' && addCategory()}
                    />
                    <button class="btn-secondary" onclick={addCategory}>Add</button>
                </div>
                
                <div class="modal-actions mt-6">
                    <button class="btn-cancel w-full" onclick={() => isSettingsOpen = false}>Done</button>
                </div>
            </div>
        {/if}
    </div>
</Modal>

<style>
  /* ... (Keep all existing styles) ... */
  .trip-history { max-width: 1200px; margin: 0 auto; padding: 12px; padding-bottom: 80px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .header-actions { display: flex; gap: 8px; align-items: center; }
  
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; 
    background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; 
    border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; 
    box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); transition: transform 0.1s; cursor: pointer;
  }
  .btn-primary:active { transform: translateY(1px); }

  .btn-secondary { display: inline-flex; align-items: center; justify-content: center; padding: 10px; 
    background: white; border: 1px solid #E5E7EB; color: #374151; border-radius: 8px; 
    font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; text-decoration: none;
  }

  @media (hover: hover) {
    .btn-secondary:hover { background: #F9FAFB; }
    .cat-delete:hover { background: #EF4444; color: white; }
    
    .page-btn:hover:not(:disabled) { border-color: #FF7F50; color: #FF7F50; }
  }

  /* Modal Styles */
  .categories-manager { padding: 4px; }
  
  /* Top Tabs for Modal */
  .top-tabs { display: flex; border-bottom: 2px solid #E5E7EB; margin-bottom: 20px; }
  .top-tab-btn { flex: 1; padding: 12px; font-weight: 600; color: #6B7280; border: none; background: none; cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -2px; }
  .top-tab-btn.active { color: #FF7F50; border-bottom-color: #FF7F50; }

  /* Sub Tabs for Categories */
  .sub-tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #E5E7EB; }
  
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

  .settings-form input:focus { outline: none; border-color: #FF7F50; ring: 2px solid rgba(255, 127, 80, 0.1); }

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
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; cursor: pointer; }
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
  
  .trip-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .trip-route-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }

  .map-link-btn { background: none; border: 1px solid #E5E7EB; color: #6B7280; cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; height: 24px; width: 24px; }
  .map-link-btn:hover { color: #FF7F50; border-color: #FF7F50; background: #FFF7ED; }

  .address-row { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #374151; margin: 4px 0; }
  .address-text { flex: 1; min-width: 0; word-break: break-word; }
  
  .mini-map-btn { background: none; border: 1px solid #E5E7EB; color: #9CA3AF; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
  .mini-map-btn:hover { color: #FF7F50; border-color: #FF7F50; background: #FFF7ED; }

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
  
/* Hide footer when selections are active - using body class */
:global(body.has-selections .mobile-footer),
:global(body.has-selections footer),
:global(body.has-selections nav[class*="mobile"]),
:global(body.has-selections .bottom-nav) {
  display: none !important;
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

  /* Tablet and up - floating style */
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
  
  .pagination-controls { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 32px; }
  .page-btn { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; font-weight: 600; font-size: 14px; color: #374151; cursor: pointer; transition: all 0.2s; }
  .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .page-status { font-size: 14px; color: #4B5563; font-weight: 500; }

  /* Loading state styles */
  .trips-loading { padding: 2rem; animation: fadeIn 0.3s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .loading-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .loading-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .loading-filters { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .skeleton { background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 0.5rem; }
  .skeleton-title { width: 200px; height: 2rem; }
  .skeleton-button { width: 120px; height: 2.5rem; }
  .skeleton-stat { height: 80px; border-radius: 12px; }
  .skeleton-input { flex: 1; height: 2.5rem; }
  .skeleton-select { width: 150px; height: 2.5rem; }
  .trip-skeleton { background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e5e7eb; }
  .skeleton-top { margin-bottom: 1rem; }
  .skeleton-text { height: 1rem; margin-bottom: 0.5rem; background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 0.25rem; }
  .skeleton-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* Error state styles */
  .trips-error { display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 2rem; animation: fadeIn 0.3s ease-out; }
  .error-content { text-align: center; max-width: 500px; }
  .error-icon { display: inline-flex; align-items: center; justify-content: center; width: 80px; height: 80px; background: #fee2e2; border-radius: 50%; color: #dc2626; margin-bottom: 1.5rem; }
  .trips-error h2 { font-size: 1.5rem; font-weight: 600; color: #111827; margin: 0 0 0.5rem; }
  .error-message { color: #6b7280; margin: 0 0 2rem; line-height: 1.6; }
  .error-message a { color: #FF7F50; text-decoration: underline; font-weight: 600; }
  .error-actions { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 2rem; }
  .error-details { margin-top: 2rem; padding: 1rem; background: #f9fafb; border-radius: 0.5rem; text-align: left; }
  .error-details summary { cursor: pointer; color: #6b7280; font-size: 0.875rem; font-weight: 500; user-select: none; }
  .error-details summary:hover { color: #374151; }
  .error-details pre { margin-top: 0.5rem; padding: 0.75rem; background: #1f2937; color: #f3f4f6; border-radius: 0.375rem; overflow-x: auto; font-size: 0.75rem; line-height: 1.5; }

  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; justify-content: space-between; align-items: center; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; flex-wrap: nowrap; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(2, 1fr); }
    .card-stats { grid-template-columns: repeat(5, 1fr); }
    .error-actions { flex-direction: row; justify-content: center; }
    .loading-stats { grid-template-columns: repeat(4, 1fr); }
    .loading-filters { flex-direction: row; }
    .skeleton-stats-grid { grid-template-columns: repeat(5, 1fr); }
  }
  @media (min-width: 1024px) {
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .search-box { max-width: 300px; }
  }
    
  .pagination-controls { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 32px; }
  .page-btn { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; font-weight: 600; font-size: 14px; color: #374151; cursor: pointer; transition: all 0.2s; }
  .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .page-status { font-size: 14px; color: #4B5563; font-weight: 500; }

  /* Loading state styles */
  .trips-loading { padding: 2rem; animation: fadeIn 0.3s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .loading-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .loading-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .loading-filters { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .skeleton { background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 0.5rem; }
  .skeleton-title { width: 200px; height: 2rem; }
  .skeleton-button { width: 120px; height: 2.5rem; }
  .skeleton-stat { height: 80px; border-radius: 12px; }
  .skeleton-input { flex: 1; height: 2.5rem; }
  .skeleton-select { width: 150px; height: 2.5rem; }
  .trip-skeleton { background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid #e5e7eb; }
  .skeleton-top { margin-bottom: 1rem; }
  .skeleton-text { height: 1rem; margin-bottom: 0.5rem; background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 0.25rem; }
  .skeleton-stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* Error state styles */
  .trips-error { display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 2rem; animation: fadeIn 0.3s ease-out; }
  .error-content { text-align: center; max-width: 500px; }
  .error-icon { display: inline-flex; align-items: center; justify-content: center; width: 80px; height: 80px; background: #fee2e2; border-radius: 50%; color: #dc2626; margin-bottom: 1.5rem; }
  .trips-error h2 { font-size: 1.5rem; font-weight: 600; color: #111827; margin: 0 0 0.5rem; }
  .error-message { color: #6b7280; margin: 0 0 2rem; line-height: 1.6; }
  .error-message a { color: #FF7F50; text-decoration: underline; font-weight: 600; }
  .error-actions { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 2rem; }
  .error-details { margin-top: 2rem; padding: 1rem; background: #f9fafb; border-radius: 0.5rem; text-align: left; }
  .error-details summary { cursor: pointer; color: #6b7280; font-size: 0.875rem; font-weight: 500; user-select: none; }
  .error-details summary:hover { color: #374151; }
  .error-details pre { margin-top: 0.5rem; padding: 0.75rem; background: #1f2937; color: #f3f4f6; border-radius: 0.375rem; overflow-x: auto; font-size: 0.75rem; line-height: 1.5; }

  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; justify-content: space-between; align-items: center; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; flex-wrap: nowrap; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(2, 1fr); }
    .card-stats { grid-template-columns: repeat(5, 1fr); }
    .error-actions { flex-direction: row; justify-content: center; }
    .loading-stats { grid-template-columns: repeat(4, 1fr); }
    .loading-filters { flex-direction: row; }
    .skeleton-stats-grid { grid-template-columns: repeat(5, 1fr); }
    
    /* Reset action bar for desktop */
    .action-bar-container { bottom: 30px; }
  }
  @media (min-width: 1024px) {
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .search-box { max-width: 300px; }
  }

/* ACTION BAR STYLES - REPLACES FOOTER ON MOBILE */
.action-bar-container { 
  position: fixed; 
  bottom: 0;
  left: 0; 
  right: 0; 
  display: flex; 
  justify-content: center; 
  z-index: 100;
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
  box-shadow: 
    0 -2px 10px rgba(0,0,0,0.1);
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

/* Tablet and up - floating style */
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
</style>