<script lang="ts">
  import { trips, isLoading } from '$lib/stores/trips';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import { toasts } from '$lib/stores/toast';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { optimizeRoute } from '$lib/services/maps';
  import { userSettings } from '$lib/stores/userSettings';
  import { onMount } from 'svelte';

  export let data;
  $: API_KEY = data?.googleMapsApiKey || '';

  // --- EXISTING PAGE STATE ---
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

  // --- NEW TRIP MODAL STATE & LOGIC ---
  let isNewTripModalOpen = false;
  let step = 1;
  let dragItemIndex: number | null = null;
  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];
  let isCalculating = false;
  
  let newMaintenanceItem = '';
  let newSupplyItem = '';
  let showAddMaintenance = false;
  let showAddSupply = false;

  function getLocalDate() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
  }

  let tripData = getInitialTripData();
  let newStop = { address: '', earnings: 0, notes: '' };

  function getInitialTripData() {
    return {
        id: crypto.randomUUID(),
        date: getLocalDate(),
        startTime: '09:00',
        endTime: '17:00',
        hoursWorked: 0,
        startAddress: $userSettings.defaultStartAddress || '',
        endAddress: $userSettings.defaultEndAddress || '',
        stops: [] as any[],
        totalMiles: 0,
        estimatedTime: 0,
        mpg: $userSettings.defaultMPG || 25,
        gasPrice: $userSettings.defaultGasPrice || 3.50,
        fuelCost: 0,
        maintenanceItems: [] as any[],
        suppliesItems: [] as any[],
        notes: ''
    };
  }

  function openNewTripModal() {
      tripData = getInitialTripData();
      step = 1;
      isNewTripModalOpen = true;
  }

  onMount(() => {
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);
  });

  // --- ROUTING LOGIC (From new/+page.svelte) ---
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
        if (finalLeg) {
            miles += finalLeg.distance;
            mins += finalLeg.duration;
        }
    }
    tripData.totalMiles = parseFloat(miles.toFixed(1));
    tripData.estimatedTime = Math.round(mins);
    tripData = { ...tripData };
  }

  async function handleOptimize() {
    if (!tripData.startAddress) return alert("Please enter a start address first.");
    if (tripData.stops.length < 2) return alert("Add at least 2 stops to optimize.");
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
      }
    } catch (e: any) { alert("Optimization failed: " + e.message);
    } finally { isCalculating = false; }
  }

  async function handleStopChange(index: number, placeOrEvent: any) {
    const val = placeOrEvent?.formatted_address || placeOrEvent?.name || tripData.stops[index].address;
    if (!val) return;
    tripData.stops[index].address = val;
    isCalculating = true;
    try {
        const prevLoc = index === 0 ? tripData.startAddress : tripData.stops[index - 1].address;
        if (prevLoc) {
            const legIn = await fetchRouteSegment(prevLoc, val);
            if (legIn) {
                tripData.stops[index].distanceFromPrev = legIn.distance;
                tripData.stops[index].timeFromPrev = legIn.duration;
            }
        }
        const nextStop = tripData.stops[index + 1];
        if (nextStop) {
            const legOut = await fetchRouteSegment(val, nextStop.address);
            if (legOut) {
                tripData.stops[index + 1].distanceFromPrev = legOut.distance;
                tripData.stops[index + 1].timeFromPrev = legOut.duration;
            }
        }
        await recalculateTotals();
    } finally { isCalculating = false; }
  }

  async function handleMainAddressChange(type: 'start' | 'end', placeOrEvent: any) {
    const val = placeOrEvent?.formatted_address || placeOrEvent?.name || (type === 'start' ? tripData.startAddress : tripData.endAddress);
    if (type === 'start') tripData.startAddress = val;
    else tripData.endAddress = val;
    isCalculating = true;
    try {
        if (type === 'start' && tripData.stops.length > 0) {
            const firstStop = tripData.stops[0];
            const leg = await fetchRouteSegment(val, firstStop.address);
            if (leg) {
                firstStop.distanceFromPrev = leg.distance;
                firstStop.timeFromPrev = leg.duration;
            }
        }
        await recalculateTotals();
    } finally { isCalculating = false; }
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
    if (!segmentStart) { alert("Please enter a Starting Address first."); return; }
    isCalculating = true;
    try {
      const segmentData: any = await fetchRouteSegment(segmentStart, newStop.address);
      if (!segmentData) throw new Error("Could not calculate route.");
      tripData.stops = [...tripData.stops, { 
        ...newStop, 
        id: crypto.randomUUID(), 
        distanceFromPrev: segmentData.distance, 
        timeFromPrev: segmentData.duration 
      }];
      await recalculateTotals();
      newStop = { address: '', earnings: 0, notes: '' };
    } catch (e) { alert("Error calculating route.");
    } finally { isCalculating = false; }
  }

  function removeStop(id: string) { 
      tripData.stops = tripData.stops.filter(s => s.id !== id);
      recalculateAllLegs();
  }

  function handleDragStart(event: DragEvent, index: number) { 
      dragItemIndex = index;
      if(event.dataTransfer) { 
          event.dataTransfer.effectAllowed = 'move'; 
          event.dataTransfer.dropEffect = 'move'; 
          event.dataTransfer.setData('text/plain', index.toString());
      } 
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
  
  function addMaintenanceItem(type: string) { tripData.maintenanceItems = [...tripData.maintenanceItems, { id: crypto.randomUUID(), type, cost: 0 }]; }
  function removeMaintenanceItem(id: string) { tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id); }
  function addCustomMaintenance() { if (!newMaintenanceItem.trim()) return; const item = newMaintenanceItem.trim(); addMaintenanceItem(item); if (!maintenanceOptions.includes(item)) { maintenanceOptions = [...maintenanceOptions, item]; localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions)); } newMaintenanceItem = ''; showAddMaintenance = false; }
  function deleteMaintenanceOption(option: string) { if (confirm(`Delete "${option}"?`)) { maintenanceOptions = maintenanceOptions.filter(o => o !== option); localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions)); } }
  
  function addSupplyItem(type: string) { tripData.suppliesItems = [...tripData.suppliesItems, { id: crypto.randomUUID(), type, cost: 0 }]; }
  function removeSupplyItem(id: string) { tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id); }
  function addCustomSupply() { if (!newSupplyItem.trim()) return; const item = newSupplyItem.trim(); addSupplyItem(item); if (!suppliesOptions.includes(item)) { suppliesOptions = [...suppliesOptions, item]; localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions)); } newSupplyItem = ''; showAddSupply = false; }
  function deleteSupplyOption(option: string) { if (confirm(`Delete "${option}"?`)) { suppliesOptions = suppliesOptions.filter(o => o !== option); localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions)); } }
  
  // Reactivity for calculations
  $: { if (tripData.totalMiles && tripData.mpg && tripData.gasPrice) { const gallons = tripData.totalMiles / tripData.mpg; tripData.fuelCost = Math.round(gallons * tripData.gasPrice * 100) / 100; } else { tripData.fuelCost = 0; } }
  $: totalEarnings = tripData.stops.reduce((sum, stop) => sum + (parseFloat(stop.earnings) || 0), 0);
  $: totalMaintenanceCost = tripData.maintenanceItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalSuppliesCost = tripData.suppliesItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalCosts = (tripData.fuelCost || 0) + totalMaintenanceCost + totalSuppliesCost;
  $: totalProfit = totalEarnings - totalCosts;
  $: { if (tripData.startTime && tripData.endTime) { const [startHour, startMin] = tripData.startTime.split(':').map(Number); const [endHour, endMin] = tripData.endTime.split(':').map(Number); let diff = (endHour * 60 + endMin) - (startHour * 60 + startMin); if (diff < 0) diff += 24 * 60; tripData.hoursWorked = Math.round((diff / 60) * 10) / 10; } }

  function nextStep() { if (step < 4) step++; }
  function prevStep() { if (step > 1) step--; }
  
  async function saveTrip() {
    const currentUser = $page.data.user || $user;
    let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
    if (!userId) { alert("Authentication error."); return; }
    
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
        isNewTripModalOpen = false;
        toasts.success("Trip saved successfully!");
    } 
    catch (err) { alert('Failed to create trip.'); }
  }

  // --- EXISTING LOGIC ---
  // Reset selection and page when filters change
  $: if (searchQuery || sortBy || sortOrder || filterProfit || startDate || endDate) {
      currentPage = 1;
  }

  // Derived: All filtered results
  $: allFilteredTrips = $trips
    .filter(trip => {
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
      if (!userId) { toasts.error('User identity missing. Cannot delete.'); return; }
      let successCount = 0;
      const ids = Array.from(selectedTrips);
      for (const id of ids) {
          try {
              await trips.deleteTrip(id, userId);
              successCount++;
          } catch (err) { console.error(`Failed to delete trip ${id}`, err); }
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);
  }
  
  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  // Format date helper for the form (local timezone)
  function formatDateLocal(dateString: string) { 
      if (!dateString) return ''; 
      const [y, m, d] = dateString.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }

  function formatTime(time: string): string {
    if (!time) return '';
    if (time.toLowerCase().includes('am') || time.toLowerCase().includes('pm')) return time;
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
    const m = Math.round(minutes % 60);
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
        if (x < -80) onDelete();
        else if (x > 80) onEdit();
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
  {:else if visibleTrips.length > 0}
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
                <div class="swipe-action edit">
                    <span>Edit</span>
                </div>
                <div class="swipe-action delete">
                    <span>Delete</span>
                </div>
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
                        <input 
                            type="checkbox" 
                            checked={isSelected} 
                            on:change={() => toggleSelection(trip.id)} 
                        />
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
                <div 
                    class="expanded-details" 
                    on:click|stopPropagation 
                    on:keydown|stopPropagation
                    role="group"
                >
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
          <button 
            class="page-btn" 
            disabled={currentPage === 1} 
            on:click={() => changePage(currentPage - 1)}
          >
            &larr; Prev
          </button>
          
          <span class="page-status">Page {currentPage} of {totalPages}</span>
          
          <button 
            class="page-btn" 
            disabled={currentPage === totalPages} 
            on:click={() => changePage(currentPage + 1)}
          >
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
                <button class="action-pill secondary" on:click={() => selectedTrips = new Set()}>
                    Cancel
                </button>
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

<Modal bind:open={isNewTripModalOpen} title="New Trip">
    <div class="new-trip-wizard-container">
      <div class="progress-steps">
        <div class="step-item" class:active={step >= 1} class:completed={step > 1}><div class="step-circle">{step > 1 ? '✓' : '1'}</div><div class="step-label">Route</div></div><div class="step-line" class:completed={step > 1}></div>
        <div class="step-item" class:active={step >= 2} class:completed={step > 2}><div class="step-circle">{step > 2 ? '✓' : '2'}</div><div class="step-label">Basics</div></div><div class="step-line" class:completed={step > 2}></div>
        <div class="step-item" class:active={step >= 3} class:completed={step > 3}><div class="step-circle">{step > 3 ? '✓' : '3'}</div><div class="step-label">Costs</div></div><div class="step-line" class:completed={step > 3}></div>
        <div class="step-item" class:active={step >= 4}><div class="step-circle">4</div><div class="step-label">Review</div></div>
      </div>
      
      <div class="form-content-scroll">
        {#if step === 1}
          <div class="modal-form-section">
            <div class="card-header-modal">
              <h2 class="card-title-modal">Route & Stops</h2>
              <button class="btn-small primary" on:click={handleOptimize} type="button" disabled={isCalculating || tripData.stops.length < 2} title="Reorder stops efficiently">{isCalculating ? 'Optimizing...' : 'Optimize'}</button>
            </div>
            
            <div class="form-group">
              <label for="start-address">Starting Address</label>
              <input id="start-address" type="text" bind:value={tripData.startAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('start', e.detail)} on:blur={(e) => handleMainAddressChange('start', { formatted_address: tripData.startAddress })} class="address-input" placeholder="Enter start address..." />
            </div>
            
            <div class="stops-container">
              <div class="stops-header"><h3>Stops</h3><span class="count">{tripData.stops.length} added</span></div>
              {#if tripData.stops.length > 0}
                <div class="stops-list">
                  {#each tripData.stops as stop, i (stop.id)}
                    <div class="stop-card" draggable="true" on:dragstart={(e) => handleDragStart(e, i)} on:drop={(e) => handleDrop(e, i)} on:dragover={handleDragOver}>
                      <div class="stop-header"><div class="stop-number">{i + 1}</div><div class="stop-actions"><button class="btn-icon delete" on:click={() => removeStop(stop.id)}>✕</button><div class="drag-handle">☰</div></div></div>
                      <div class="stop-inputs">
                        <input type="text" bind:value={stop.address} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleStopChange(i, e.detail)} on:blur={() => handleStopChange(i, { formatted_address: stop.address })} class="address-input" placeholder="Stop address" />
                        <div class="input-money-wrapper"><span class="symbol">$</span><input type="number" class="input-money" bind:value={stop.earnings} step="0.01" placeholder="Earnings" /></div>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="add-stop-form">
                <div class="stop-inputs new">
                  <input type="text" bind:value={newStop.address} placeholder="New stop address..." use:autocomplete={{ apiKey: API_KEY }} on:place-selected={handleNewStopSelect} class="address-input" />
                  <div class="input-money-wrapper"><span class="symbol">$</span><input type="number" class="input-money" placeholder="0.00" bind:value={newStop.earnings} step="0.01" min="0" /></div>
                </div>
                <button class="btn-add full-width" on:click={addStop} disabled={isCalculating}>{isCalculating ? 'Calculating...' : '+ Add Stop'}</button>
              </div>
            </div>
            
            <div class="form-group">
              <label for="end-address">End Address (Optional)</label>
              <input id="end-address" type="text" bind:value={tripData.endAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('end', e.detail)} on:blur={(e) => handleMainAddressChange('end', { formatted_address: tripData.endAddress })} class="address-input" placeholder="Same as start if empty" />
            </div>

            <div class="form-row">
                <div class="form-group"><label for="total-miles">Total Miles</label><input id="total-miles" type="number" bind:value={tripData.totalMiles} step="0.1" /></div>
                <div class="form-group"><label for="drive-time">Drive Time <span class="hint">(Est)</span></label><div id="drive-time" class="readonly-field">{formatDuration(tripData.estimatedTime)}</div></div>
            </div>
            <div class="form-actions-modal"><button class="btn-primary full-width" on:click={nextStep}>Continue</button></div>
          </div>
        {/if}
        
        {#if step === 2} <div class="modal-form-section"><div class="card-header-modal"><h2 class="card-title-modal">Basic Information</h2></div><div class="form-grid"><div class="form-group"><label for="trip-date">Date</label><input id="trip-date" type="date" bind:value={tripData.date} required /></div><div class="form-row"><div class="form-group"><label for="start-time">Start Time</label><input id="start-time" type="time" bind:value={tripData.startTime} /></div><div class="form-group"><label for="end-time">End Time</label><input id="end-time" type="time" bind:value={tripData.endTime} /></div></div><div class="form-group"><label for="hours-display">Hours Worked</label><div id="hours-display" class="readonly-field">{tripData.hoursWorked.toFixed(1)} hours</div></div></div><div class="form-actions-modal"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={nextStep}>Continue</button></div></div> {/if}
        {#if step === 3} <div class="modal-form-section"><div class="card-header-modal"><h2 class="card-title-modal">Costs</h2></div><div class="form-row"><div class="form-group"><label for="mpg">MPG</label><input id="mpg" type="number" bind:value={tripData.mpg} step="0.1" /></div><div class="form-group"><label for="gas-price">Gas Price</label><div class="input-money-wrapper"><span class="symbol">$</span><input id="gas-price" type="number" bind:value={tripData.gasPrice} step="0.01" /></div></div></div><div class="summary-box" style="margin: 40px 0;"><span>Estimated Fuel Cost</span><strong>{formatCurrency(tripData.fuelCost)}</strong></div><div class="section-group"><div class="section-top"><h3>Maintenance</h3><button class="btn-text" on:click={() => showAddMaintenance = !showAddMaintenance}>+ Custom</button></div>{#if showAddMaintenance}<div class="add-custom-row"><input type="text" bind:value={newMaintenanceItem} placeholder="Item name..." /><button class="btn-small primary" on:click={addCustomMaintenance}>Add</button></div>{/if}<div class="chips-row">{#each maintenanceOptions as option}<div class="option-badge"><button class="badge-btn" on:click={() => addMaintenanceItem(option)}>{option}</button><button class="badge-delete" on:click={() => deleteMaintenanceOption(option)}>✕</button></div>{/each}</div>{#each tripData.maintenanceItems as item}<div class="expense-row"><span class="name">{item.type}</span><div class="input-money-wrapper small"><span class="symbol">$</span><input type="number" bind:value={item.cost} placeholder="0.00" /></div><button class="btn-icon delete" on:click={() => removeMaintenanceItem(item.id)}>✕</button></div>{/each}</div><div class="section-group"><div class="section-top"><h3>Supplies</h3><button class="btn-text" on:click={() => showAddSupply = !showAddSupply}>+ Custom</button></div>{#if showAddSupply}<div class="add-custom-row"><input type="text" bind:value={newSupplyItem} placeholder="Item name..." /><button class="btn-small primary" on:click={addCustomSupply}>Add</button></div>{/if}<div class="chips-row">{#each suppliesOptions as option}<div class="option-badge"><button class="badge-btn" on:click={() => addSupplyItem(option)}>{option}</button><button class="badge-delete" on:click={() => deleteSupplyOption(option)}>✕</button></div>{/each}</div>{#each tripData.suppliesItems as item}<div class="expense-row"><span class="name">{item.type}</span><div class="input-money-wrapper small"><span class="symbol">$</span><input type="number" bind:value={item.cost} placeholder="0.00" /></div><button class="btn-icon delete" on:click={() => removeSupplyItem(item.id)}>✕</button></div>{/each}</div><div class="form-group"><label for="notes">Notes</label><textarea id="notes" bind:value={tripData.notes} rows="3" placeholder="Trip details..."></textarea></div><div class="form-actions-modal"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={nextStep}>Review</button></div></div> {/if}
        {#if step === 4} <div class="modal-form-section"><div class="card-header-modal"><h2 class="card-title-modal">Review</h2></div><div class="review-grid"><div class="review-tile"><span class="review-label">Date</span><div>{formatDateLocal(tripData.date)}</div></div><div class="review-tile"><span class="review-label">Total Time</span><div>{tripData.hoursWorked.toFixed(1)} hrs</div></div><div class="review-tile"><span class="review-label">Drive Time</span><div>{formatDuration(tripData.estimatedTime)}</div></div><div class="review-tile"><span class="review-label">Hours Worked</span><div>{Math.max(0, tripData.hoursWorked - (tripData.estimatedTime / 60)).toFixed(1)} hrs</div></div><div class="review-tile"><span class="review-label">Distance</span><div>{tripData.totalMiles} mi</div></div><div class="review-tile"><span class="review-label">Stops</span><div>{tripData.stops.length}</div></div></div><div class="financial-summary"><div class="row"><span>Earnings</span> <span class="val positive">{formatCurrency(totalEarnings)}</span></div><div class="row subheader"><span>Expenses Breakdown</span></div>{#if tripData.fuelCost > 0}<div class="row detail"><span>Fuel</span> <span class="val">{formatCurrency(tripData.fuelCost)}</span></div>{/if}{#each tripData.maintenanceItems as item}<div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>{/each}{#each tripData.suppliesItems as item}<div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>{/each}<div class="row total-expenses"><span>Total Expenses</span> <span class="val negative">-{formatCurrency(totalCosts)}</span></div><div class="row total"><span>Net Profit</span> <span class="val" class:positive={totalProfit >= 0}>{formatCurrency(totalProfit)}</span></div></div><div class="form-actions-modal"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={saveTrip}>Save Trip</button></div></div> {/if}
      </div>
    </div>
</Modal>

<style>
  .trip-history { max-width: 1200px; margin: 0 auto; padding: 12px; padding-bottom: 80px; }

  .batch-header { 
      display: flex; justify-content: space-between; align-items: center; 
      margin-bottom: 12px; padding: 0 4px; color: #6B7280; font-size: 13px; font-weight: 500;
  }

  .pagination-controls { 
      display: flex; justify-content: center; align-items: center; gap: 16px; margin-top: 32px;
  }
  .page-btn {
      padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px;
      font-weight: 600; font-size: 14px; color: #374151; cursor: pointer; transition: all 0.2s;
  }
  .page-btn:hover:not(:disabled) { border-color: #FF7F50; color: #FF7F50; }
  .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .page-status { font-size: 14px; color: #4B5563; font-weight: 500; }

  /* Existing Styles Preserved */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .page-title { font-size: 24px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; margin: 0; }
  .header-actions { display: flex; gap: 12px; align-items: center; }
  .btn-primary { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; box-shadow: 0 2px 8px rgba(255, 127, 80, 0.3); cursor: pointer; }
  
  .stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; text-align: center; }
  .summary-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .summary-value { font-size: 20px; font-weight: 800; color: #111827; }
  
  .filters-bar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  
  /* Sticky Filters Style */
  .sticky-bar {
      position: sticky; top: 0; z-index: 10;
      background: #F9FAFB; /* Match page bg */
      padding-top: 10px; padding-bottom: 10px;
      margin: -12px -12px 10px -12px; /* Pull out of parent padding */
      padding-left: 12px; padding-right: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02); /* Subtle separation */
  }

  .search-box { position: relative; width: 100%; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
  .search-box input { width: 100%; padding: 12px 16px 12px 42px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  .search-box input:focus { outline: none; border-color: #FF7F50; }
  .date-group { display: flex; gap: 8px; align-items: center; }
  .date-input { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; min-width: 0; box-sizing: border-box; }
  .date-sep { color: #9CA3AF; font-weight: bold; }
  .filter-group { display: flex; flex-direction: row; gap: 8px; width: 100%; }
  .filter-select { flex: 1; width: 0; min-width: 0; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 14px; background: white; color: #374151; }
  .sort-btn { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border: 1px solid #E5E7EB; border-radius: 10px; background: white; color: #6B7280; }
  
  /* CHECKBOX STYLES */
  .checkbox-container { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; color: #4B5563; position: relative; padding-left: 28px; user-select: none; }
  .checkbox-container input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
  .checkmark { position: absolute; top: 0; left: 0; height: 20px; width: 20px; background-color: white; border: 2px solid #D1D5DB; border-radius: 6px; transition: all 0.2s; }
  .checkbox-container:hover input ~ .checkmark { border-color: #9CA3AF; }
  .checkbox-container input:checked ~ .checkmark { background-color: #FF7F50; border-color: #FF7F50; }
  .checkmark:after { content: ""; position: absolute; display: none; }
  .checkbox-container input:checked ~ .checkmark:after { display: block; }
  .checkbox-container .checkmark:after { left: 6px; top: 2px; width: 5px; height: 10px; border: solid white; border-width: 0 2px 2px 0; transform: rotate(45deg); }

  .trip-list-cards { display: flex; flex-direction: column; gap: 12px; }
  
  /* Swipe Wrapper & Backgrounds */
  .trip-card-wrapper { position: relative; overflow: hidden; border-radius: 12px; background: #F3F4F6; }
  .swipe-bg { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 20px; z-index: 0; }
  .swipe-action { font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .swipe-action.edit { color: #2563EB; }
  .swipe-action.delete { color: #DC2626; }

  .trip-card { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s; position: relative; z-index: 1; }
  .trip-card:active { background-color: #F9FAFB; }
  .trip-card.expanded { border-color: #FF7F50; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
  .trip-card.selected { background-color: #FFF7ED; border-color: #FF7F50; }

  /* Highlight Animation */
  @keyframes pulse-border {
      0% { border-color: #FF7F50; box-shadow: 0 0 0 0 rgba(255, 127, 80, 0.4); }
      70% { border-color: #FF7F50; box-shadow: 0 0 0 10px rgba(255, 127, 80, 0); }
      100% { border-color: #E5E7EB; box-shadow: 0 0 0 0 rgba(255, 127, 80, 0); }
  }
  :global(.highlight-pulse) { animation: pulse-border 2s ease-out; }

  .card-top { display: grid; grid-template-columns: auto 1fr auto 20px; align-items: center; gap: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #F3F4F6; }
  .selection-box { display: flex; align-items: center; justify-content: center; }
  .trip-route-date { overflow: hidden; }
  .trip-date-display { display: block; font-size: 12px; font-weight: 600; color: #6B7280; margin-bottom: 4px; }
  .time-range { color: #4B5563; margin-left: 4px; font-weight: 500; }
  .trip-route-title { font-size: 16px; font-weight: 700; color: #111827; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .profit-display-large { font-size: 18px; font-weight: 800; white-space: nowrap; }
  .profit-display-large.positive { color: var(--green); }
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
  .section-heading { font-size: 13px; font-weight: 700; color: var(--navy); margin-bottom: 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; }
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

  /* FLOATING ACTION BAR */
  .action-bar-container { position: fixed; bottom: 20px; left: 0; right: 0; display: flex; justify-content: center; z-index: 50; padding: 0 16px; animation: slideUp 0.3s ease-out; }
  .action-bar { background: #1F2937; color: white; padding: 8px 16px; border-radius: 100px; display: flex; align-items: center; gap: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
  .selected-count { font-weight: 700; font-size: 14px; }
  .action-buttons { display: flex; gap: 8px; }
  .action-pill { border: none; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s; }
  .action-pill.secondary { background: #374151; color: #E5E7EB; }
  .action-pill.secondary:hover { background: #4B5563; }
  .action-pill.export { background: #E5E7EB; color: #1F2937; }
  .action-pill.export:hover { background: #F3F4F6; }
  .action-pill.danger { background: #EF4444; color: white; }
  .action-pill.danger:hover { background: #DC2626; }

  @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

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

  /* --- MODAL WIZARD STYLES (Adapted from new/+page.svelte) --- */
  .new-trip-wizard-container { width: 100%; display: flex; flex-direction: column; height: 70vh; /* Fixed height for modal content */ }
  
  .progress-steps { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding: 0 4px; flex-shrink: 0; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 1; }
  .step-circle { width: 32px; height: 32px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; border: 2px solid #fff; }
  .step-item.active .step-circle { background: #FF7F50; color: white; }
  .step-item.completed .step-circle { background: #10B981; color: white; }
  .step-label { font-size: 12px; font-weight: 600; color: #9CA3AF; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 2px; background: #E5E7EB; margin: 0 -4px 18px -4px; position: relative; z-index: 0; }
  .step-line.completed { background: #10B981; }

  .form-content-scroll { flex: 1; overflow-y: auto; padding-right: 4px; }
  .modal-form-section { display: flex; flex-direction: column; gap: 16px; }

  .card-header-modal { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .card-title-modal { font-size: 18px; font-weight: 700; color: #111827; margin: 0; }
  
  .form-grid { display: flex; flex-direction: column; gap: 16px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 14px; font-weight: 600; color: #374151; }
  .hint { color: #9CA3AF; font-weight: 400; }
  input, textarea { width: 100%; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 15px; background: white; box-sizing: border-box; }
  input:focus, textarea:focus { outline: none; border-color: #FF7F50; }
  .readonly-field { background: #F9FAFB; padding: 12px; border-radius: 10px; border: 1px solid #E5E7EB; color: #6B7280; font-weight: 500; font-size: 15px; }
  .address-input { padding-top: 14px; padding-bottom: 14px; }
  
  .input-money-wrapper { position: relative; width: 100%; }
  .input-money-wrapper .symbol { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; font-size: 15px; }
  .input-money-wrapper input { padding-left: 28px; }
  .input-money-wrapper.small input { padding: 8px 8px 8px 24px; font-size: 14px; }
  .input-money-wrapper.small .symbol { left: 10px; font-size: 14px; }

  .stops-container { margin: 16px 0; border: 1px solid #E5E7EB; border-radius: 12px; padding: 12px; background: #F9FAFB; }
  .stops-header { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center; }
  .stops-header h3 { font-size: 16px; font-weight: 700; margin: 0; }
  .stops-header .count { font-size: 12px; color: #6B7280; background: #E5E7EB; padding: 4px 10px; border-radius: 8px; }
  .stops-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
  .stop-card { background: white; border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
  .stop-header { display: flex; justify-content: space-between; align-items: center; }
  .stop-number { background: #FF7F50; color: white; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
  .stop-actions { display: flex; gap: 12px; align-items: center; color: #9CA3AF; }
  .stop-inputs { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .stop-inputs.new { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }

  .form-actions-modal { display: flex; gap: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #E5E7EB; }
  .btn-add { background: #2563EB; color: white; margin-top: 8px; font-size: 14px; padding: 12px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; width: 100%; }
  .btn-icon { background: none; border: none; font-size: 18px; cursor: pointer; color: #9CA3AF; padding: 4px; }
  .btn-icon.delete:hover { color: #DC2626; }
  .btn-text { background: none; border: none; color: #2563EB; font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn-small { padding: 8px 12px; border-radius: 6px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; }
  .btn-small.primary { background: #10B981; color: white; }
  .btn-secondary { background: white; border: 1px solid #E5E7EB; color: #374151; }

  .summary-box { background: #ECFDF5; border: 1px solid #A7F3D0; padding: 16px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; color: #065F46; margin-bottom: 24px; font-size: 16px; }
  .section-group { margin-bottom: 24px; }
  .section-top { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center; }
  .section-top h3 { font-size: 16px; font-weight: 700; margin: 0; }
  .add-custom-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .add-custom-row input { flex: 1; padding: 10px; }
  .chips-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .option-badge { display: inline-flex; align-items: stretch; background: white; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; }
  .badge-btn { padding: 6px 10px; border: none; background: transparent; font-size: 13px; font-weight: 500; color: #4B5563; cursor: pointer; border-right: 1px solid #E5E7EB; }
  .badge-btn:hover { background: #F9FAFB; color: #FF7F50; }
  .badge-delete { padding: 0 8px; border: none; background: #FEF2F2; color: #DC2626; cursor: pointer; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .badge-delete:hover { background: #FCA5A5; color: white; }
  
  .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .review-tile { background: #F9FAFB; padding: 12px; border-radius: 10px; border: 1px solid #E5E7EB; }
  .review-tile .review-label { display: block; font-size: 11px; color: #6B7280; text-transform: uppercase; margin-bottom: 2px; }
  .review-tile div { font-weight: 700; font-size: 15px; color: #111827; }
  .financial-summary { background: #F9FAFB; padding: 16px; border-radius: 12px; border: 1px solid #E5E7EB; }
  .financial-summary .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 15px; }
  .financial-summary .row.subheader { font-weight: 700; color: #374151; margin-top: 12px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 6px; font-size: 13px; }
  .financial-summary .row.detail { font-size: 13px; color: #6B7280; }
  .financial-summary .row.total-expenses { font-weight: 600; color: #4B5563; border-top: 1px dashed #D1D5DB; padding-top: 6px; }
  .financial-summary .total { border-top: 2px solid #D1D5DB; margin-top: 12px; padding-top: 12px; font-weight: 800; font-size: 18px; }
  .val.positive { color: #059669; }
  .val.negative { color: #DC2626; }
  
  .full-width { width: 100%; }

  @media (min-width: 640px) {
    .stop-card { flex-direction: row; align-items: center; }
    .stop-inputs { display: grid; grid-template-columns: 1fr 140px; }
    .stop-inputs.new { display: grid; grid-template-columns: 1fr 140px; }
  }
</style>