<script lang="ts">
  import { trips, isLoading } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Modal from '$lib/components/ui/Modal.svelte'; // [!code ++]
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import { toasts } from '$lib/stores/toast';
  import { autocomplete } from '$lib/utils/autocomplete'; // [!code ++]
  import { optimizeRoute } from '$lib/services/maps'; // [!code ++]
  import { onMount } from 'svelte';

  export let data; // [!code ++] Need data for API Key
  $: API_KEY = data?.googleMapsApiKey || '';

  // --- EXISTING LIST STATE ---
  let searchQuery = '';
  let sortBy = 'date';
  let sortOrder = 'desc';
  let filterProfit = 'all'; 
  let startDate = '';
  let endDate = '';
  let currentPage = 1;
  const itemsPerPage = 20;
  let selectedTrips = new Set<string>();

  // --- NEW TRIP MODAL STATE ---
  let isTripModalOpen = false;
  let step = 1;
  let dragItemIndex: number | null = null;
  let isCalculating = false;
  
  // Options
  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];

  // Helper to get local date (Fixes tomorrow bug)
  function getLocalDate() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
  }

  let tripData = {
    id: crypto.randomUUID(),
    date: getLocalDate(),
    startTime: '09:00',
    endTime: '17:00',
    hoursWorked: 0,
    startAddress: '',
    endAddress: '',
    stops: [] as any[],
    totalMiles: 0,
    estimatedTime: 0,
    mpg: 25,
    gasPrice: 3.50,
    fuelCost: 0,
    maintenanceItems: [] as any[],
    suppliesItems: [] as any[],
    notes: ''
  };

  let newStop = { address: '', earnings: 0, notes: '' };
  let newMaintenanceItem = '';
  let newSupplyItem = '';
  let showAddMaintenance = false;
  let showAddSupply = false;

  // --- INITIALIZATION ---
  onMount(() => {
    // Load saved options
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);
  });

  // Open Modal & Reset Data
  function openNewTripModal() {
    // Reset Data
    tripData = {
      id: crypto.randomUUID(),
      date: getLocalDate(),
      startTime: '09:00',
      endTime: '17:00',
      hoursWorked: 0,
      startAddress: $userSettings.defaultStartAddress || '',
      endAddress: $userSettings.defaultEndAddress || '',
      stops: [],
      totalMiles: 0,
      estimatedTime: 0,
      mpg: $userSettings.defaultMPG || 25,
      gasPrice: $userSettings.defaultGasPrice || 3.50,
      fuelCost: 0,
      maintenanceItems: [],
      suppliesItems: [],
      notes: ''
    };
    step = 1;
    isTripModalOpen = true;
  }

  // --- TRIP CALCULATION LOGIC (Ported from new/+page.svelte) ---
  function generateRouteKey(start: string, end: string) {
    const s = start.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    const e = end.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    return `kv_route_${s}_to_${e}`;
  }

  async function fetchRouteSegment(start: string, end: string) {
    if (!start || !end) return null;
    const localKey = generateRouteKey(start, end);
    const cached = localStorage.getItem(localKey);
    if (cached) return JSON.parse(cached);

    try {
        const res = await fetch(`/api/directions/cache?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
        const result = await res.json();
        if (result.data) {
            const mappedResult = {
                distance: result.data.distance * 0.000621371,
                duration: result.data.duration / 60
            };
            localStorage.setItem(localKey, JSON.stringify(mappedResult));
            return mappedResult;
        }
    } catch (err) { console.error("Routing failed:", err); }
    return null;
  }

  async function recalculateAllLegs() {
    isCalculating = true;
    try {
        let prevAddress = tripData.startAddress;
        for (let i = 0; i < tripData.stops.length; i++) {
            const currentStop = tripData.stops[i];
            if (prevAddress && currentStop.address) {
                const leg = await fetchRouteSegment(prevAddress, currentStop.address);
                if (leg) {
                    currentStop.distanceFromPrev = leg.distance;
                    currentStop.timeFromPrev = leg.duration;
                }
            }
            prevAddress = currentStop.address;
        }
        await recalculateTotals();
    } finally { isCalculating = false; }
  }

  async function recalculateTotals() {
    let miles = tripData.stops.reduce((acc, s) => acc + (s.distanceFromPrev || 0), 0);
    let mins = tripData.stops.reduce((acc, s) => acc + (s.timeFromPrev || 0), 0);
    const lastStop = tripData.stops[tripData.stops.length - 1];
    const startPoint = lastStop ? lastStop.address : tripData.startAddress;
    const endPoint = tripData.endAddress || tripData.startAddress;

    if (startPoint && endPoint) {
        const finalLeg = await fetchRouteSegment(startPoint, endPoint);
        if (finalLeg) { miles += finalLeg.distance; mins += finalLeg.duration; }
    }
    tripData.totalMiles = parseFloat(miles.toFixed(1));
    tripData.estimatedTime = Math.round(mins);
    tripData = { ...tripData };
  }

  async function handleOptimize() {
    if (!tripData.startAddress) return toasts.error("Please enter a start address first.");
    if (tripData.stops.length < 2) return toasts.error("Add at least 2 stops to optimize.");
    isCalculating = true;
    try {
      const result = await optimizeRoute(tripData.startAddress, tripData.endAddress, tripData.stops);
      if (result.optimizedOrder) {
        const currentStops = [...tripData.stops];
        let orderedStops = [];
        if (!tripData.endAddress) {
           const movingStops = currentStops.slice(0, -1);
           const fixedLast = currentStops[currentStops.length - 1];
           orderedStops = result.optimizedOrder.map((i: number) => movingStops[i]);
           orderedStops.push(fixedLast);
        } else {
           orderedStops = result.optimizedOrder.map((i: number) => currentStops[i]);
        }
        tripData.stops = orderedStops;
        if (result.legs) {
           tripData.stops.forEach((stop, i) => {
             if (result.legs[i]) {
                stop.distanceFromPrev = result.legs[i].distance.value * 0.000621371;
                stop.timeFromPrev = result.legs[i].duration.value / 60;
             }
           });
        }
        await recalculateTotals();
        toasts.success("Route optimized!");
      }
    } catch (e: any) { toasts.error("Optimization failed: " + e.message); } 
    finally { isCalculating = false; }
  }

  async function handleMainAddressChange(type: 'start' | 'end', placeOrEvent: any) {
    const val = placeOrEvent?.formatted_address || placeOrEvent?.name || (type === 'start' ? tripData.startAddress : tripData.endAddress);
    if (type === 'start') tripData.startAddress = val; else tripData.endAddress = val;
    
    // Auto-calc logic simplified for modal
    if (type === 'start' && tripData.stops.length > 0) recalculateAllLegs();
  }

  async function handleNewStopSelect(e: CustomEvent) {
    const place = e.detail;
    if (place?.formatted_address || place?.name) {
        newStop.address = place.formatted_address || place.name;
        await addStop();
    }
  }

  async function addStop() {
    if (!newStop.address) return;
    let segmentStart = tripData.stops.length > 0 ? tripData.stops[tripData.stops.length - 1].address : tripData.startAddress;
    if (!segmentStart) { toasts.error("Please enter a Starting Address first."); return; }
    
    isCalculating = true;
    try {
      const segmentData: any = await fetchRouteSegment(segmentStart, newStop.address);
      if (!segmentData) throw new Error("Could not calculate route.");
      tripData.stops = [...tripData.stops, { 
        ...newStop, id: crypto.randomUUID(), distanceFromPrev: segmentData.distance, timeFromPrev: segmentData.duration 
      }];
      await recalculateTotals();
      newStop = { address: '', earnings: 0, notes: '' };
    } catch (e) { toasts.error("Error calculating route."); } 
    finally { isCalculating = false; }
  }

  function removeStop(id: string) { 
      tripData.stops = tripData.stops.filter(s => s.id !== id);
      recalculateAllLegs();
  }

  // --- DRAG & DROP ---
  function handleDragStart(event: DragEvent, index: number) { 
      dragItemIndex = index;
      if(event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.dropEffect = 'move'; event.dataTransfer.setData('text/plain', index.toString()); } 
  }
  function handleDragOver(event: DragEvent) { event.preventDefault(); return false; }
  async function handleDrop(event: DragEvent, dropIndex: number) {
      event.preventDefault();
      if (dragItemIndex === null) return;
      const item = tripData.stops[dragItemIndex];
      const newStops = tripData.stops.filter((_, i) => i !== dragItemIndex);
      newStops.splice(dropIndex, 0, item);
      tripData.stops = newStops;
      dragItemIndex = null;
      await recalculateAllLegs();
  }

  // --- COSTS & SAVING ---
  function addMaintenanceItem(type: string) { tripData.maintenanceItems = [...tripData.maintenanceItems, { id: crypto.randomUUID(), type, cost: 0 }]; }
  function removeMaintenanceItem(id: string) { tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id); }
  function addSupplyItem(type: string) { tripData.suppliesItems = [...tripData.suppliesItems, { id: crypto.randomUUID(), type, cost: 0 }]; }
  function removeSupplyItem(id: string) { tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id); }

  $: { if (tripData.totalMiles && tripData.mpg && tripData.gasPrice) { const gallons = tripData.totalMiles / tripData.mpg; tripData.fuelCost = Math.round(gallons * tripData.gasPrice * 100) / 100; } else { tripData.fuelCost = 0; } }
  $: totalEarnings = tripData.stops.reduce((sum, stop) => sum + (parseFloat(stop.earnings) || 0), 0);
  $: totalMaintenanceCost = tripData.maintenanceItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalSuppliesCost = tripData.suppliesItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalCosts = (tripData.fuelCost || 0) + totalMaintenanceCost + totalSuppliesCost;
  $: totalProfit = totalEarnings - totalCosts;
  
  async function saveTrip() {
    const currentUser = $page.data.user || $user;
    let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
    if (!userId) { toasts.error("Authentication error."); return; }
    
    const tripToSave = {
      ...tripData,
      maintenanceCost: totalMaintenanceCost,
      suppliesCost: totalSuppliesCost,
      netProfit: totalProfit,
      totalMileage: tripData.totalMiles,
      fuelCost: tripData.fuelCost,
      stops: tripData.stops.map((stop, index) => ({ ...stop, earnings: Number(stop.earnings), order: index })),
      destinations: tripData.stops.map(stop => ({ address: stop.address, earnings: stop.earnings, notes: stop.notes || '' })),
      lastModified: new Date().toISOString()
    };
    try { 
        await trips.create(tripToSave, userId); 
        toasts.success('Trip saved successfully!');
        isTripModalOpen = false; // Close modal
    } 
    catch (err) { toasts.error('Failed to create trip.'); }
  }

  // --- LIST HELPERS ---
  $: if (searchQuery || sortBy || sortOrder || filterProfit || startDate || endDate) {
      currentPage = 1;
  }

  $: allFilteredTrips = $trips.filter(trip => {
      // ... existing filter logic ...
      const query = searchQuery.toLowerCase();
      const matchesSearch = !query || 
        trip.startAddress?.toLowerCase().includes(query) ||
        trip.stops?.some(stop => stop.address?.toLowerCase().includes(query)) ||
        trip.notes?.toLowerCase().includes(query);
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
        if (startDate) { const start = new Date(startDate); start.setHours(0,0,0,0); if (tripDate < start) return false; }
        if (endDate) { const end = new Date(endDate); end.setHours(0,0,0,0); if (tripDate > end) return false; }
      }
      return true;
  }).sort((a, b) => {
      // ... existing sort logic ...
      let aVal, bVal;
      switch (sortBy) {
        case 'date': aVal = new Date(a.date || 0).getTime(); bVal = new Date(b.date || 0).getTime(); break;
        case 'profit': 
            aVal = calculateNetProfit(a); bVal = calculateNetProfit(b); break;
        case 'miles': aVal = a.totalMiles || 0; bVal = b.totalMiles || 0; break;
        default: return 0;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  $: totalPages = Math.ceil(allFilteredTrips.length / itemsPerPage);
  $: visibleTrips = allFilteredTrips.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  $: allSelected = allFilteredTrips.length > 0 && selectedTrips.size === allFilteredTrips.length;

  function toggleSelection(id: string) {
      if (selectedTrips.has(id)) selectedTrips.delete(id); else selectedTrips.add(id);
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

  // --- ACTIONS ---
  async function deleteSelected() {
      if (!confirm(`Delete ${selectedTrips.size} trips?`)) return;
      const currentUser = $page.data.user || $user;
      let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id') || '';
      if (!userId) return;
      for (const id of selectedTrips) await trips.deleteTrip(id, userId);
      toasts.success(`Deleted ${selectedTrips.size} trips.`);
      selectedTrips = new Set();
  }

  function exportSelected() {
      // ... existing export logic ...
      const selectedData = allFilteredTrips.filter(t => selectedTrips.has(t.id));
      if (selectedData.length === 0) return;
      const headers = ['Date', 'Start', 'End', 'Miles', 'Profit', 'Notes'];
      const rows = selectedData.map(t => {
          const profit = calculateNetProfit(t);
          return [t.date, `"${t.startAddress}"`, `"${t.endAddress}"`, t.totalMiles, profit.toFixed(2), `"${(t.notes || '').replace(/"/g, '""')}"`].join(',');
      });
      const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `trips_export.csv`; a.click();
      toasts.success(`Exported.`);
      selectedTrips = new Set();
  }

  // --- HELPERS ---
  function formatCurrency(amount: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount); }
  function formatDate(dateString: string): string { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(dateString)); }
  function formatTime(time: string): string { 
      if (!time) return '';
      const [h, m] = time.split(':').map(Number);
      if (isNaN(h)) return time;
      return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function formatDuration(minutes: number): string {
    if (!minutes) return '-';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  
  async function deleteTrip(id: string) {
    if (confirm('Move trip to trash?')) {
      const currentUser = $page.data.user || $user;
      let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id') || '';
      if (userId) await trips.deleteTrip(id, userId);
    }
  }
  
  function editTrip(id: string) { goto(`/dashboard/trips/edit/${id}`); }
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
  
  // Selection/Expand Logic
  let expandedTrips = new Set<string>();
  function toggleExpand(id: string) { if (expandedTrips.has(id)) expandedTrips.delete(id); else expandedTrips.add(id); expandedTrips = expandedTrips; }
  
  // Swipe Action
  function swipeable(node: HTMLElement, { onEdit, onDelete }: { onEdit: () => void, onDelete: () => void }) {
    let startX = 0, startY = 0, x = 0, swiping = false;
    function handleTouchStart(e: TouchEvent) { startX = e.touches[0].clientX; startY = e.touches[0].clientY; x = 0; node.style.transition = 'none'; }
    function handleTouchMove(e: TouchEvent) {
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) return;
        swiping = true;
        if (dx < -120) x = -120; else if (dx > 120) x = 120; else x = dx;
        node.style.transform = `translateX(${x}px)`;
        if (Math.abs(x) > 10) e.preventDefault();
    }
    function handleTouchEnd() {
        if (!swiping) return;
        swiping = false;
        node.style.transition = 'transform 0.2s ease-out';
        if (x < -80) onDelete(); else if (x > 80) onEdit();
        node.style.transform = 'translateX(0)';
    }
    node.addEventListener('touchstart', handleTouchStart, { passive: false });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd);
    return { destroy() { node.removeEventListener('touchstart', handleTouchStart); node.removeEventListener('touchmove', handleTouchMove); node.removeEventListener('touchend', handleTouchEnd); } }
  }
</script>

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
        <button class="btn-primary" on:click={openNewTripModal} aria-label="Create New Trip">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          New Trip
        </button>
    </div>
  </div>
  
  <div class="stats-summary">
    <div class="summary-card">
      <div class="summary-label">Total Trips</div>
      <div class="summary-value">{allFilteredTrips.length}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Miles</div>
      <div class="summary-value">{allFilteredTrips.reduce((sum, trip) => sum + (trip.totalMiles || 0), 0).toFixed(1)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Profit</div>
      <div class="summary-value">{formatCurrency(allFilteredTrips.reduce((sum, trip) => sum + calculateNetProfit(trip), 0))}</div>
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
        
        <div class="trip-card-wrapper">
            <div class="swipe-bg">
                <div class="swipe-action edit"><span>Edit</span></div>
                <div class="swipe-action delete"><span>Delete</span></div>
            </div>

            <div class="trip-card" id={'trip-' + trip.id} class:expanded={isExpanded} class:selected={isSelected} on:click={() => toggleExpand(trip.id)} use:swipeable={{ onEdit: () => editTrip(trip.id), onDelete: () => deleteTrip(trip.id) }}>
              <div class="card-top">
                 <div class="selection-box" on:click|stopPropagation>
                    <label class="checkbox-container">
                        <input type="checkbox" checked={isSelected} on:change={() => toggleSelection(trip.id)} />
                        <span class="checkmark"></span>
                    </label>
                </div>
                <div class="trip-route-date">
                  <span class="trip-date-display">
                      {formatDate(trip.date || '')}
                      {#if trip.startTime} <span class="time-range">• {formatTime(trip.startTime)} - {formatTime(trip.endTime || '17:00')}</span> {/if}
                  </span>
                  <h3 class="trip-route-title">
                    {trip.startAddress?.split(',')[0] || 'Unknown'} 
                    {#if trip.stops && trip.stops.length > 0} → {trip.stops[trip.stops.length - 1].address?.split(',')[0] || 'Stop'} {/if}
                  </h3>
                </div>
                <div class="profit-display-large" class:positive={profit >= 0} class:negative={profit < 0}>{formatCurrency(profit)}</div>
                <svg class="expand-icon" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 15L10 11L14 15M14 5L10 9L6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </div>

              <div class="card-stats">
                <div class="stat-item"><span class="stat-label">Miles</span><span class="stat-value">{trip.totalMiles?.toFixed(1) || '0.0'}</span></div>
                <div class="stat-item"><span class="stat-label">Stops</span><span class="stat-value">{trip.stops?.length || 0}</span></div>
                <div class="stat-item"><span class="stat-label">Hours</span><span class="stat-value">{trip.hoursWorked?.toFixed(1) || '-'}</span></div>
                <div class="stat-item"><span class="stat-label">Drive</span><span class="stat-value">{formatDuration(trip.estimatedTime)}</span></div>
                <div class="stat-item"><span class="stat-label">$/Hr</span><span class="stat-value hourly-pay">{trip.hoursWorked > 0 ? formatCurrency(hourlyPay) : '-'}</span></div>
              </div>
              
              {#if isExpanded}
                <div class="expanded-details" on:click|stopPropagation>
                  <div class="detail-section">
                     <h4 class="section-heading">Stops & Addresses</h4>
                     <div class="address-list">
                        <p><strong>Start:</strong> {trip.startAddress}</p>
                        {#if trip.stops}
                           {#each trip.stops as stop, i} <p><strong>Stop {i + 1}:</strong> {stop.address}</p> {/each}
                        {/if}
                        {#if trip.endAddress && trip.endAddress !== trip.startAddress} <p><strong>End:</strong> {trip.endAddress}</p> {/if}
                     </div>
                  </div>
                  {#if totalCosts > 0}
                    <div class="detail-section">
                      <h4 class="section-heading">Expenses</h4>
                      <div class="expense-list">
                        {#if trip.fuelCost > 0} <div class="expense-row"><span>Fuel</span><span>{formatCurrency(trip.fuelCost)}</span></div> {/if}
                        <div class="expense-row total"><span>Total</span><span>{formatCurrency(totalCosts)}</span></div>
                      </div>
                    </div>
                  {/if}
                  <div class="action-buttons-footer">
                    <button class="action-btn-lg edit-btn" on:click={() => editTrip(trip.id)}>Edit</button>
                    <button class="action-btn-lg delete-btn" on:click={() => deleteTrip(trip.id)}>Trash</button>
                  </div>
                </div>
              {/if}
            </div>
        </div>
      {/each}
    </div>
    {#if totalPages > 1}
      <div class="pagination-controls">
          <button class="page-btn" disabled={currentPage === 1} on:click={() => changePage(currentPage - 1)}>&larr; Prev</button>
          <span class="page-status">Page {currentPage} of {totalPages}</span>
          <button class="page-btn" disabled={currentPage === totalPages} on:click={() => changePage(currentPage + 1)}>Next &rarr;</button>
      </div>
    {/if}
  {:else}
    <div class="empty-state"><p>No trips found matching your filters.</p></div>
  {/if}
</div>

<Modal bind:open={isTripModalOpen} title="New Trip">
    <div class="wizard-container">
        <div class="progress-steps">
            <div class="step-item" class:active={step >= 1} class:completed={step > 1}><div class="step-circle">{step > 1 ? '✓' : '1'}</div><div class="step-label">Route</div></div>
            <div class="step-line" class:completed={step > 1}></div>
            <div class="step-item" class:active={step >= 2} class:completed={step > 2}><div class="step-circle">{step > 2 ? '✓' : '2'}</div><div class="step-label">Details</div></div>
            <div class="step-line" class:completed={step > 2}></div>
            <div class="step-item" class:active={step >= 3} class:completed={step > 3}><div class="step-circle">{step > 3 ? '✓' : '3'}</div><div class="step-label">Costs</div></div>
            <div class="step-line" class:completed={step > 3}></div>
            <div class="step-item" class:active={step >= 4}><div class="step-circle">4</div><div class="step-label">Review</div></div>
        </div>

        <div class="wizard-content">
            {#if step === 1}
                <div class="form-section">
                    <label class="label">Start Address</label>
                    <input type="text" bind:value={tripData.startAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('start', e.detail)} on:blur={(e) => handleMainAddressChange('start', { formatted_address: tripData.startAddress })} class="input-field" placeholder="Enter start..." />
                    
                    <div class="stops-section">
                        <div class="section-header"><span>Stops</span> <span class="badge">{tripData.stops.length}</span></div>
                        {#each tripData.stops as stop, i}
                            <div class="stop-item">
                                <span class="stop-num">{i + 1}</span>
                                <input type="text" bind:value={stop.address} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleStopChange(i, e.detail)} on:blur={() => handleStopChange(i, { formatted_address: stop.address })} class="input-field" />
                                <div class="money-input"><span>$</span><input type="number" bind:value={stop.earnings} placeholder="0" /></div>
                                <button class="btn-icon" on:click={() => removeStop(stop.id)}>✕</button>
                            </div>
                        {/each}
                        <div class="new-stop-row">
                            <input type="text" bind:value={newStop.address} placeholder="Add Stop..." use:autocomplete={{ apiKey: API_KEY }} on:place-selected={handleNewStopSelect} class="input-field" />
                            <div class="money-input"><span>$</span><input type="number" bind:value={newStop.earnings} placeholder="0" /></div>
                            <button class="btn-secondary small" on:click={addStop} disabled={isCalculating}>Add</button>
                        </div>
                    </div>

                    <label class="label">End Address (Optional)</label>
                    <input type="text" bind:value={tripData.endAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('end', e.detail)} on:blur={(e) => handleMainAddressChange('end', { formatted_address: tripData.endAddress })} class="input-field" placeholder="Same as start..." />
                    
                    <div class="metrics-row">
                        <div><span class="label">Miles:</span> <strong>{tripData.totalMiles}</strong></div>
                        <div><span class="label">Time:</span> <strong>{formatDuration(tripData.estimatedTime)}</strong></div>
                    </div>
                    
                    <button class="btn-secondary w-full mt-2" on:click={handleOptimize} disabled={isCalculating || tripData.stops.length < 2}>
                        {isCalculating ? 'Optimizing...' : 'Optimize Route'}
                    </button>
                </div>
            {/if}

            {#if step === 2}
                <div class="form-section">
                    <label class="label">Date</label>
                    <input type="date" bind:value={tripData.date} class="input-field" />
                    <div class="row-2">
                        <div><label class="label">Start Time</label><input type="time" bind:value={tripData.startTime} class="input-field" /></div>
                        <div><label class="label">End Time</label><input type="time" bind:value={tripData.endTime} class="input-field" /></div>
                    </div>
                </div>
            {/if}

            {#if step === 3}
                <div class="form-section">
                    <div class="row-2">
                        <div><label class="label">MPG</label><input type="number" bind:value={tripData.mpg} step="0.1" class="input-field" /></div>
                        <div><label class="label">Gas Price</label><input type="number" bind:value={tripData.gasPrice} step="0.01" class="input-field" /></div>
                    </div>
                    <div class="cost-summary">Est. Fuel: <strong>{formatCurrency(tripData.fuelCost)}</strong></div>
                    
                    <label class="label mt-4">Maintenance Items</label>
                    <div class="chips">
                        {#each maintenanceOptions as opt}
                            <button class="chip" on:click={() => addMaintenanceItem(opt)}>{opt}</button>
                        {/each}
                    </div>
                    {#each tripData.maintenanceItems as item}
                        <div class="expense-item"><span>{item.type}</span> <input type="number" bind:value={item.cost} class="input-field small" placeholder="$" /> <button on:click={() => removeMaintenanceItem(item.id)}>✕</button></div>
                    {/each}

                    <label class="label mt-4">Notes</label>
                    <textarea bind:value={tripData.notes} class="input-field" rows="2"></textarea>
                </div>
            {/if}

            {#if step === 4}
                <div class="review-section">
                    <div class="review-row"><span>Earnings</span> <span class="text-green-600 font-bold">{formatCurrency(totalEarnings)}</span></div>
                    <div class="review-row"><span>Expenses</span> <span class="text-red-600 font-bold">-{formatCurrency(totalCosts)}</span></div>
                    <div class="review-row border-t mt-2 pt-2"><span>Profit</span> <span class="font-bold text-lg">{formatCurrency(totalProfit)}</span></div>
                    <div class="review-stats">
                        <span>{tripData.totalMiles} mi</span> • <span>{tripData.stops.length} stops</span>
                    </div>
                </div>
            {/if}
        </div>

        <div class="wizard-actions">
            {#if step > 1}
                <button class="btn-secondary" on:click={() => step--}>Back</button>
            {:else}
                <button class="btn-secondary" on:click={() => isTripModalOpen = false}>Cancel</button>
            {/if}
            
            {#if step < 4}
                <button class="btn-primary" on:click={() => step++}>Next</button>
            {:else}
                <button class="btn-primary" on:click={saveTrip}>Save Trip</button>
            {/if}
        </div>
    </div>
</Modal>

<style>
  /* Same styles as Expense Page for Consistency */
  .trip-history { max-width: 1200px; margin: 0 auto; padding: 12px; padding-bottom: 80px; }
  
  /* Wizard Styles */
  .wizard-container { padding: 8px 0; }
  .progress-steps { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding: 0 10px; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .step-circle { width: 28px; height: 28px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; }
  .step-item.active .step-circle { background: #FF7F50; color: white; }
  .step-item.completed .step-circle { background: #10B981; color: white; }
  .step-label { font-size: 11px; font-weight: 600; color: #9CA3AF; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 2px; background: #E5E7EB; margin: 0 4px 14px 4px; }
  .step-line.completed { background: #10B981; }

  .form-section { display: flex; flex-direction: column; gap: 12px; }
  .label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 4px; display: block; }
  .input-field { padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 14px; width: 100%; box-sizing: border-box; }
  .input-field.small { padding: 6px; width: 80px; }
  
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  
  .stops-section { background: #F9FAFB; padding: 12px; border-radius: 10px; border: 1px solid #E5E7EB; }
  .section-header { display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: #6B7280; margin-bottom: 8px; }
  .stop-item, .new-stop-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .stop-num { background: #FF7F50; color: white; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .money-input { position: relative; width: 80px; flex-shrink: 0; }
  .money-input span { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 12px; color: #6B7280; }
  .money-input input { padding: 8px 8px 8px 20px; width: 100%; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
  
  .wizard-actions { display: flex; gap: 12px; margin-top: 24px; }
  .btn-primary { flex: 1; background: #111827; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .btn-secondary { flex: 1; background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .btn-secondary.small { padding: 8px 12px; font-size: 12px; flex: 0 0 auto; }
  .btn-icon { background: none; border: none; color: #9CA3AF; cursor: pointer; }
  .btn-icon:hover { color: #DC2626; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { background: white; border: 1px solid #E5E7EB; padding: 4px 10px; border-radius: 100px; font-size: 11px; cursor: pointer; transition: all 0.2s; }
  .chip:hover { border-color: #FF7F50; color: #FF7F50; }
  .expense-item { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #E5E7EB; }

  .review-section { background: #F9FAFB; padding: 16px; border-radius: 12px; text-align: center; }
  .review-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
  .review-stats { margin-top: 12px; font-size: 12px; color: #6B7280; }

  /* Existing Page Styles */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }
  .filters-bar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .search-box { position: relative; width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { width: 100%; padding: 12px 16px 12px 42px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  .date-group { display: flex; gap: 8px; align-items: center; }
  .date-input { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; min-width: 0; box-sizing: border-box; }
  .date-sep { color: #9CA3AF; font-weight: bold; }
  .filter-group { display: flex; flex-direction: row; gap: 8px; width: 100%; }
  .filter-select { flex: 1; width: 0; min-width: 0; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; }
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; }
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
  .trip-card.expanded { border-color: #FF7F50; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
  .trip-card.selected { background-color: #FFF7ED; border-color: #FF7F50; }
  .card-top { display: grid; grid-template-columns: auto 1fr auto 20px; align-items: center; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .trip-date-display { display: block; font-size: 12px; font-weight: 600; color: #6B7280; margin-bottom: 4px; }
  .trip-route-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profit-display-large { font-size: 18px; font-weight: 800; white-space: nowrap; }
  .profit-display-large.positive { color: #059669; }
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
  .section-heading { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
  .address-list p { font-size: 14px; color: #374151; margin: 4px 0; }
  .expense-list { display: flex; flex-direction: column; gap: 4px; }
  .expense-row { display: flex; justify-content: space-between; font-size: 13px; color: #4B5563; }
  .expense-row.total { border-top: 1px solid #E5E7EB; margin-top: 4px; padding-top: 4px; font-weight: 700; color: #111827; }
  .action-buttons-footer { display: flex; gap: 12px; }
  .action-btn-lg { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border-radius: 8px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.2s; border: 2px solid; font-size: 14px; }
  .edit-btn { background: #EFF6FF; color: #2563EB; border-color: #2563EB; }
  .delete-btn { background: #FEF2F2; color: #DC2626; border-color: #DC2626; }
  .empty-state { text-align: center; padding: 40px 20px; color: #6B7280; font-size: 15px; }
  .batch-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding: 0 4px; color: #6B7280; font-size: 13px; font-weight: 500; }
  .pagination-controls { display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 32px; }
  .page-btn { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; font-weight: 600; font-size: 14px; color: #374151; cursor: pointer; transition: all 0.2s; }
  .page-btn:hover:not(:disabled) { border-color: #FF7F50; color: #FF7F50; }
  .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .page-status { font-size: 14px; color: #4B5563; font-weight: 500; }
  
  @media (min-width: 640px) {
    .filters-bar { flex-direction: row; justify-content: space-between; align-items: center; }
    .search-box { max-width: 300px; }
    .date-group { width: auto; }
    .filter-group { width: auto; flex-wrap: nowrap; }
    .filter-select { width: 140px; flex: none; }
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
    .card-stats { grid-template-columns: repeat(5, 1fr); }
  }
</style>