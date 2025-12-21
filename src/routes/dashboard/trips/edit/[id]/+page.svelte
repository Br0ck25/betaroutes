<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import { autocomplete } from '$lib/utils/autocomplete'; 
  import { optimizeRoute } from '$lib/services/maps';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { toasts } from '$lib/stores/toast';
  import Button from '$lib/components/ui/Button.svelte';

  export let data;
  $: API_KEY = data.googleMapsApiKey;
  const tripId = $page.params.id;
  
  let step = 1;
  let loading = true;
  let isCalculating = false;
  let dragItemIndex: number | null = null;

  $: maintenanceOptions = $userSettings.maintenanceCategories?.length > 0 
      ? $userSettings.maintenanceCategories 
      : ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];

  $: suppliesOptions = $userSettings.supplyCategories?.length > 0 
      ? $userSettings.supplyCategories 
      : ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];

  let selectedMaintenance = '';
  let selectedSupply = '';

  let isManageCategoriesOpen = false;
  let activeCategoryType: 'maintenance' | 'supplies' = 'maintenance';
  let newCategoryName = '';
  $: activeCategories = activeCategoryType === 'maintenance' ? maintenanceOptions : suppliesOptions;

  let showUpgradeModal = false;
  let upgradeMessage = '';

  function getLocalDate() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
  }

  onMount(async () => { await loadTripData(); });
  async function loadTripData() {
    const currentUser = $page.data.user || $user;
    let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');
    if (!$trips || $trips.length === 0) { if (userId) await trips.load(userId); }
    const found = $trips.find(t => t.id === tripId);
    if (!found) { toasts.error('Trip not found'); goto('/dashboard/trips'); return; }
    const safeStops = (found.stops || []).map((s: any) => ({ ...s, id: s.id || crypto.randomUUID(), distanceFromPrev: s.distanceFromPrev || 0, timeFromPrev: s.timeFromPrev || 0 }));
    const safeMaintenance = (found.maintenanceItems || []).map((m: any) => ({ ...m, id: m.id || crypto.randomUUID() }));
    const rawSupplies = found.supplyItems || found.suppliesItems || [];
    const safeSupplies = rawSupplies.map((s: any) => ({ ...s, id: s.id || crypto.randomUUID() }));
    const to24h = (timeStr: string) => { if (!timeStr) return ''; if (!timeStr.match(/AM|PM/i)) return timeStr; const [time, modifier] = timeStr.split(' '); let [hours, minutes] = time.split(':'); let h = parseInt(hours, 10); if (h === 12) h = 0; if (modifier && modifier.toUpperCase() === 'PM') h += 12; return `${h.toString().padStart(2, '0')}:${minutes}`; };
    tripData = { ...JSON.parse(JSON.stringify(found)), date: found.date || getLocalDate(), stops: safeStops, maintenanceItems: safeMaintenance, suppliesItems: safeSupplies, totalMiles: Number(found.totalMiles) || 0, mpg: Number(found.mpg) || $userSettings.defaultMPG || 25, gasPrice: Number(found.gasPrice) || $userSettings.defaultGasPrice || 3.50, fuelCost: Number(found.fuelCost) || 0, hoursWorked: Number(found.hoursWorked) || 0, estimatedTime: found.estimatedTime || 0, startTime: to24h(found.startTime), endTime: to24h(found.endTime) };
    loading = false;
  }

  let tripData = { id: crypto.randomUUID(), date: getLocalDate(), startTime: '09:00', endTime: '17:00', hoursWorked: 0, startAddress: '', endAddress: '', stops: [] as any[], totalMiles: 0, estimatedTime: 0, mpg: 25, gasPrice: 3.50, fuelCost: 0, maintenanceItems: [] as any[], suppliesItems: [] as any[], notes: '' };
  let newStop = { address: '', earnings: 0, notes: '' };
  function formatDuration(minutes: number): string { if (!minutes) return '0 min'; const h = Math.floor(minutes / 60); const m = Math.round(minutes % 60); if (h > 0) return `${h} hr ${m} min`; return `${m} min`; }
  
  function generateRouteKey(start: string, end: string) { const s = start.toLowerCase().trim().replace(/[^a-z0-9]/g, ''); const e = end.toLowerCase().trim().replace(/[^a-z0-9]/g, ''); return `kv_route_${s}_to_${e}`; }
  async function fetchRouteSegment(start: string, end: string) { if (!start || !end) return null; const localKey = generateRouteKey(start, end); const cached = localStorage.getItem(localKey); if (cached) { return JSON.parse(cached); } try { const res = await fetch(`/api/directions/cache?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`); const result = await res.json(); if (result.data) { const mappedResult = { distance: result.data.distance * 0.000621371, duration: result.data.duration / 60 }; localStorage.setItem(localKey, JSON.stringify(mappedResult)); return mappedResult; } } catch (err) { console.error("Routing failed:", err); } return null; }
  async function recalculateAllLegs() { isCalculating = true; try { let prevAddress = tripData.startAddress; for (let i = 0; i < tripData.stops.length; i++) { const currentStop = tripData.stops[i]; if (prevAddress && currentStop.address) { const leg = await fetchRouteSegment(prevAddress, currentStop.address); if (leg) { currentStop.distanceFromPrev = leg.distance; currentStop.timeFromPrev = leg.duration; } } prevAddress = currentStop.address; } await recalculateTotals(); } finally { isCalculating = false; } }
  async function recalculateTotals() { let miles = tripData.stops.reduce((acc, s) => acc + (s.distanceFromPrev || 0), 0); let mins = tripData.stops.reduce((acc, s) => acc + (s.timeFromPrev || 0), 0); const lastStop = tripData.stops[tripData.stops.length - 1]; const startPoint = lastStop ? lastStop.address : tripData.startAddress; const endPoint = tripData.endAddress || tripData.startAddress; if (startPoint && endPoint) { const finalLeg = await fetchRouteSegment(startPoint, endPoint); if (finalLeg) { miles += finalLeg.distance; mins += finalLeg.duration; } } tripData.totalMiles = parseFloat(miles.toFixed(1)); tripData.estimatedTime = Math.round(mins); tripData = { ...tripData }; }

  async function handleOptimize() {
    if (!tripData.startAddress) { toasts.error("Please enter a start address first."); return; }
    if ($user?.plan === 'free') { upgradeMessage = "Route Optimization is a Pro feature. Upgrade now to save time and fuel automatically!"; showUpgradeModal = true; return; }
    if (tripData.stops.length < 2) { toasts.error("Add at least 2 stops to optimize."); return; }
    isCalculating = true;
    try {
      const result = await optimizeRoute(tripData.startAddress, tripData.endAddress, tripData.stops);
      if (result.optimizedOrder) {
        const currentStops = [...tripData.stops];
        let orderedStops = [];
        if (!tripData.endAddress) { const movingStops = currentStops.slice(0, -1); const fixedLast = currentStops[currentStops.length - 1]; orderedStops = result.optimizedOrder.map((i: number) => movingStops[i]); orderedStops.push(fixedLast); } 
        else { orderedStops = result.optimizedOrder.map((i: number) => currentStops[i]); }
        tripData.stops = orderedStops;
        if (result.legs) { tripData.stops.forEach((stop, i) => { if (result.legs[i]) { stop.distanceFromPrev = result.legs[i].distance.value * 0.000621371; stop.timeFromPrev = result.legs[i].duration.value / 60; } }); }
        await recalculateTotals();
        toasts.success("Route optimized!");
      }
    } catch (e: any) {
      console.error(e);
      const msg = (e.message || '').toLowerCase();
      if (e.code === 'PLAN_LIMIT' || msg.includes('plan limit') || msg.includes('pro feature')) { upgradeMessage = e.message || "Route Optimization is a Pro feature."; showUpgradeModal = true; } else { toasts.error("Optimization failed: " + e.message); }
    } finally { isCalculating = false; }
  }

  async function handleStopChange(index: number, placeOrEvent: any) { const val = placeOrEvent?.formatted_address || placeOrEvent?.name || tripData.stops[index].address; if (!val) return; tripData.stops[index].address = val; isCalculating = true; try { const prevLoc = index === 0 ? tripData.startAddress : tripData.stops[index - 1].address; if (prevLoc) { const legIn = await fetchRouteSegment(prevLoc, val); if (legIn) { tripData.stops[index].distanceFromPrev = legIn.distance; tripData.stops[index].timeFromPrev = legIn.duration; } } const nextStop = tripData.stops[index + 1]; if (nextStop) { const legOut = await fetchRouteSegment(val, nextStop.address); if (legOut) { tripData.stops[index + 1].distanceFromPrev = legOut.distance; tripData.stops[index + 1].timeFromPrev = legOut.duration; } } await recalculateTotals(); } finally { isCalculating = false; } }
  async function handleMainAddressChange(type: 'start' | 'end', placeOrEvent: any) { const val = placeOrEvent?.formatted_address || placeOrEvent?.name || (type === 'start' ? tripData.startAddress : tripData.endAddress); if (type === 'start') tripData.startAddress = val; else tripData.endAddress = val; isCalculating = true; try { if (type === 'start' && tripData.stops.length > 0) { const firstStop = tripData.stops[0]; const leg = await fetchRouteSegment(val, firstStop.address); if (leg) { firstStop.distanceFromPrev = leg.distance; firstStop.timeFromPrev = leg.duration; } } await recalculateTotals(); } finally { isCalculating = false; } }
  async function handleNewStopSelect(e: CustomEvent) { const place = e.detail; if (place?.formatted_address || place?.name) { newStop.address = place.formatted_address || place.name; await addStop(); } }
  
  async function addStop() {
    if (!newStop.address) return;
    if ($user?.plan === 'free' && tripData.stops.length >= 10) { upgradeMessage = "The Free plan is limited to 10 stops per trip. Upgrade to Pro for unlimited stops!"; showUpgradeModal = true; return; }
    let segmentStart = tripData.stops.length > 0 ? tripData.stops[tripData.stops.length - 1].address : tripData.startAddress;
    if (!segmentStart) { toasts.error("Please enter a Starting Address first."); return; }
    isCalculating = true;
    try { const segmentData: any = await fetchRouteSegment(segmentStart, newStop.address); if (!segmentData) throw new Error("Could not calculate route."); tripData.stops = [...tripData.stops, { ...newStop, id: crypto.randomUUID(), distanceFromPrev: segmentData.distance, timeFromPrev: segmentData.duration }]; await recalculateTotals(); newStop = { address: '', earnings: 0, notes: '' }; } catch (e) { toasts.error("Error calculating route segment."); } finally { isCalculating = false; }
  }

  function removeStop(id: string) { tripData.stops = tripData.stops.filter(s => s.id !== id); recalculateAllLegs(); }
  function handleDragStart(event: DragEvent, index: number) { dragItemIndex = index; if(event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.dropEffect = 'move'; event.dataTransfer.setData('text/plain', index.toString()); } }
  function handleDragOver(event: DragEvent) { event.preventDefault(); return false; }
  async function handleDrop(event: DragEvent, dropIndex: number) { event.preventDefault(); if (dragItemIndex === null) return; const item = tripData.stops[dragItemIndex]; const newStops = tripData.stops.filter((_, i) => i !== dragItemIndex); newStops.splice(dropIndex, 0, item); tripData.stops = newStops; dragItemIndex = null; await recalculateAllLegs(); }
  function addMaintenanceItem() { if (!selectedMaintenance) return; tripData.maintenanceItems = [...tripData.maintenanceItems, { id: crypto.randomUUID(), type: selectedMaintenance, cost: 0 }]; selectedMaintenance = ''; }
  function removeMaintenanceItem(id: string) { tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id); }
  function addSupplyItem() { if (!selectedSupply) return; tripData.suppliesItems = [...tripData.suppliesItems, { id: crypto.randomUUID(), type: selectedSupply, cost: 0 }]; selectedSupply = ''; }
  function removeSupplyItem(id: string) { tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id); }
  function openSettings(type: 'maintenance' | 'supplies') { activeCategoryType = type; isManageCategoriesOpen = true; }
  async function updateCategories(newCategories: string[]) { const updateData: any = {}; if (activeCategoryType === 'maintenance') { userSettings.update(s => ({ ...s, maintenanceCategories: newCategories })); updateData.maintenanceCategories = newCategories; } else { userSettings.update(s => ({ ...s, supplyCategories: newCategories })); updateData.supplyCategories = newCategories; } try { await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updateData) }); } catch (e) { console.error('Failed to sync settings', e); toasts.error('Saved locally, but sync failed'); } }
  async function addCategory() { if (!newCategoryName.trim()) return; const val = newCategoryName.trim(); if (activeCategories.some(c => c.toLowerCase() === val.toLowerCase())) { toasts.error('Category already exists'); return; } const updated = [...activeCategories, val]; await updateCategories(updated); newCategoryName = ''; toasts.success('Category added'); }
  async function removeCategory(cat: string) { if (!confirm(`Delete "${cat}" category?`)) return; const updated = activeCategories.filter(c => c !== cat); await updateCategories(updated); toasts.success('Category removed'); }
  
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
    if (!userId) { toasts.error("Authentication error. Please login."); return; }
    
    const tripToSave = {
      ...tripData,
      id: tripId, 
      maintenanceCost: totalMaintenanceCost,
      suppliesCost: totalSuppliesCost,
      netProfit: totalProfit,
      totalMileage: tripData.totalMiles,
      fuelCost: tripData.fuelCost,
      stops: tripData.stops.map((stop, index) => ({ ...stop, earnings: Number(stop.earnings), order: index })),
      destinations: tripData.stops.map(stop => ({ address: stop.address, earnings: stop.earnings, notes: stop.notes || '' })),
      supplyItems: tripData.suppliesItems,
      suppliesItems: tripData.suppliesItems,
      updatedAt: new Date().toISOString()
    };
    try { 
        await trips.updateTrip(tripId, tripToSave, userId); 
        toasts.success('Trip updated successfully!');
        goto('/dashboard/trips');
    } catch (err: any) { 
        console.error('Update failed:', err);
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('plan limit') || msg.includes('limit reached')) {
             upgradeMessage = "You've hit the limit of the Free plan. Upgrade to continue!";
             showUpgradeModal = true;
        } else {
             toasts.error('Failed to update trip: ' + err.message);
        }
    }
  }
  
  function formatCurrency(amount: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount); }
  function formatDateLocal(dateString: string) { if (!dateString) return ''; const [y, m, d] = dateString.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }); }
</script>

<div class="trip-form">
  <div class="page-header">
    <div><h1 class="page-title">Edit Trip</h1><p class="page-subtitle">Update route and expenses</p></div>
    <a href="/dashboard/trips" class="btn-back"><svg width="24" height="24" viewBox="0 0 20 20" fill="none"><path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Back</a>
  </div>
  
  <div class="progress-steps">
    <div class="step-item" class:active={step >= 1} class:completed={step > 1}><div class="step-circle">{step > 1 ? '✓' : '1'}</div><div class="step-label">Route</div></div><div class="step-line" class:completed={step > 1}></div>
    <div class="step-item" class:active={step >= 2} class:completed={step > 2}><div class="step-circle">{step > 2 ? '✓' : '2'}</div><div class="step-label">Basics</div></div><div class="step-line" class:completed={step > 2}></div>
    <div class="step-item" class:active={step >= 3} class:completed={step > 3}><div class="step-circle">{step > 3 ? '✓' : '3'}</div><div class="step-label">Costs</div></div><div class="step-line" class:completed={step > 3}></div>
    <div class="step-item" class:active={step >= 4}><div class="step-circle">4</div><div class="step-label">Review</div></div>
  </div>
  
  <div class="form-content">
    {#if step === 1}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Route & Stops</h2>
          <button class="btn-small primary" on:click={handleOptimize} type="button" disabled={isCalculating} title="Reorder stops efficiently">{isCalculating ? 'Optimizing...' : 'Optimize'}</button>
        </div>
        <div class="form-group"><label for="start-address">Starting Address</label><input id="start-address" type="text" bind:value={tripData.startAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('start', e.detail)} on:blur={(e) => handleMainAddressChange('start', { formatted_address: tripData.startAddress })} class="address-input" placeholder="Enter start address..." /></div>
        <div class="stops-container">
          <div class="stops-header"><h3>Stops</h3><span class="count">{tripData.stops.length} added</span></div>
          {#if tripData.stops.length > 0}
            <div class="stops-list">
              {#each tripData.stops as stop, i (stop.id)}
                <div class="stop-card" draggable="true" on:dragstart={(e) => handleDragStart(e, i)} on:drop={(e) => handleDrop(e, i)} on:dragover={handleDragOver}>
                  <div class="stop-header"><div class="stop-number">{i + 1}</div><div class="stop-actions"><button class="btn-icon delete" on:click={() => removeStop(stop.id)}>✕</button><div class="drag-handle">☰</div></div></div>
                  <div class="stop-inputs">
                    <input type="text" bind:value={stop.address} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleStopChange(i, e.detail)} on:blur={() => handleStopChange(i, { formatted_address: stop.address })} class="address-input" placeholder="Address" />
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

          </div>
        </div>
        <div class="form-group"><label for="end-address">End Address (Optional)</label><input id="end-address" type="text" bind:value={tripData.endAddress} use:autocomplete={{ apiKey: API_KEY }} on:place-selected={(e) => handleMainAddressChange('end', e.detail)} on:blur={(e) => handleMainAddressChange('end', { formatted_address: tripData.endAddress })} class="address-input" placeholder="Same as start if empty" /></div>
        <div class="form-row"><div class="form-group"><label for="total-miles">Total Miles</label><input id="total-miles" type="number" bind:value={tripData.totalMiles} step="0.1" /></div><div class="form-group"><label for="drive-time">Drive Time <span class="hint">(Est)</span></label><div id="drive-time" class="readonly-field">{formatDuration(tripData.estimatedTime)}</div></div></div>
        <div class="form-actions"><button class="btn-primary full-width" on:click={nextStep}>Continue</button></div>
      </div>
    {/if}
    {#if step === 2} <div class="form-card"><div class="card-header"><h2 class="card-title">Basic Information</h2></div><div class="form-grid"><div class="form-group"><label for="trip-date">Date</label><input id="trip-date" type="date" bind:value={tripData.date} required /></div><div class="form-row"><div class="form-group"><label for="start-time">Start Time</label><input id="start-time" type="time" bind:value={tripData.startTime} /></div><div class="form-group"><label for="end-time">End Time</label><input id="end-time" type="time" bind:value={tripData.endTime} /></div></div><div class="form-group"><label for="hours-display">Hours Worked</label><div id="hours-display" class="readonly-field">{tripData.hoursWorked.toFixed(1)} hours</div></div></div><div class="form-actions"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={nextStep}>Continue</button></div></div> {/if}
    {#if step === 3} <div class="form-card"><div class="card-header"><h2 class="card-title">Costs</h2></div><div class="form-row"><div class="form-group"><label for="mpg">MPG</label><input id="mpg" type="number" bind:value={tripData.mpg} step="0.1" /></div><div class="form-group"><label for="gas-price">Gas Price</label><div class="input-money-wrapper"><span class="symbol">$</span><input id="gas-price" type="number" bind:value={tripData.gasPrice} step="0.01" /></div></div></div><div class="summary-box" style="margin: 40px 0;"><span>Estimated Fuel Cost</span><strong>{formatCurrency(tripData.fuelCost)}</strong></div><div class="section-group"><div class="section-top"><h3>Maintenance</h3><button class="btn-icon gear" on:click={() => openSettings('maintenance')} title="Manage Options"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button></div><div class="add-row"><select bind:value={selectedMaintenance} class="select-input"><option value="" disabled selected>Select Item...</option>{#each maintenanceOptions as option}<option value={option}>{option}</option>{/each}</select><button class="btn-small primary" on:click={addMaintenanceItem} disabled={!selectedMaintenance}>Add</button></div>{#each tripData.maintenanceItems as item}<div class="expense-row"><span class="name">{item.type}</span><div class="input-money-wrapper small"><span class="symbol">$</span><input type="number" bind:value={item.cost} placeholder="0.00" /></div><button class="btn-icon delete" on:click={() => removeMaintenanceItem(item.id)}>✕</button></div>{/each}</div><div class="section-group"><div class="section-top"><h3>Supplies</h3><button class="btn-icon gear" on:click={() => openSettings('supplies')} title="Manage Options"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button></div><div class="add-row"><select bind:value={selectedSupply} class="select-input"><option value="" disabled selected>Select Item...</option>{#each suppliesOptions as option}<option value={option}>{option}</option>{/each}</select><button class="btn-small primary" on:click={addSupplyItem} disabled={!selectedSupply}>Add</button></div>{#each tripData.suppliesItems as item}<div class="expense-row"><span class="name">{item.type}</span><div class="input-money-wrapper small"><span class="symbol">$</span><input type="number" bind:value={item.cost} placeholder="0.00" /></div><button class="btn-icon delete" on:click={() => removeSupplyItem(item.id)}>✕</button></div>{/each}</div><div class="form-group"><label for="notes">Notes</label><textarea id="notes" bind:value={tripData.notes} rows="3" placeholder="Trip details..."></textarea></div><div class="form-actions"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={saveTrip}>Update Trip</button></div></div> {/if}
    {#if step === 4} <div class="form-card"><div class="card-header"><h2 class="card-title">Review</h2></div><div class="review-grid"><div class="review-tile"><span class="review-label">Date</span><div>{formatDateLocal(tripData.date)}</div></div><div class="review-tile"><span class="review-label">Total Time</span><div>{tripData.hoursWorked.toFixed(1)} hrs</div></div><div class="review-tile"><span class="review-label">Drive Time</span><div>{formatDuration(tripData.estimatedTime)}</div></div><div class="review-tile"><span class="review-label">Hours Worked</span><div>{Math.max(0, tripData.hoursWorked - (tripData.estimatedTime / 60)).toFixed(1)} hrs</div></div><div class="review-tile"><span class="review-label">Distance</span><div>{tripData.totalMiles} mi</div></div><div class="review-tile"><span class="review-label">Stops</span><div>{tripData.stops.length}</div></div></div><div class="financial-summary"><div class="row"><span>Earnings</span> <span class="val positive">{formatCurrency(totalEarnings)}</span></div><div class="row subheader"><span>Expenses Breakdown</span></div>{#if tripData.fuelCost > 0}<div class="row detail"><span>Fuel</span> <span class="val">{formatCurrency(tripData.fuelCost)}</span></div>{/if}{#each tripData.maintenanceItems as item}<div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>{/each}{#each tripData.suppliesItems as item}<div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>{/each}<div class="row total-expenses"><span>Total Expenses</span> <span class="val negative">-{formatCurrency(totalCosts)}</span></div><div class="row total"><span>Net Profit</span> <span class="val" class:positive={totalProfit >= 0}>{formatCurrency(totalProfit)}</span></div></div><div class="form-actions"><button class="btn-secondary" on:click={prevStep}>Back</button><button class="btn-primary" on:click={saveTrip}>Update Trip</button></div></div> {/if}
  </div>
</div>

<Modal bind:open={isManageCategoriesOpen} title="Manage Options">
    <div class="categories-manager">
        <div class="tabs">
            <button class="tab-btn" class:active={activeCategoryType === 'maintenance'} on:click={() => activeCategoryType = 'maintenance'}>Maintenance</button>
            <button class="tab-btn" class:active={activeCategoryType === 'supplies'} on:click={() => activeCategoryType = 'supplies'}>Supplies</button>
        </div>
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
            <input type="text" bind:value={newCategoryName} placeholder="New Item Name..." class="input-field" on:keydown={(e) => e.key === 'Enter' && addCategory()} />
            <button class="btn-secondary" on:click={addCategory}>Add</button>
        </div>
        <div class="modal-actions mt-6">
            <button class="btn-cancel w-full" on:click={() => isManageCategoriesOpen = false}>Done</button>
        </div>
    </div>
</Modal>

<Modal bind:open={showUpgradeModal} title="Upgrade to Pro">
    <div class="space-y-6 text-center py-4">
        <div class="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
            <span class="text-3xl">🚀</span>
        </div>
        
        <h3 class="text-xl font-bold text-gray-900">Unlock Pro Features</h3>
        
        <p class="text-gray-600">
            {upgradeMessage || "You've hit the limits of the Free plan."}
        </p>

        <div class="bg-gray-50 p-4 rounded-lg text-left text-sm space-y-2 border border-gray-100">
            <div class="flex items-center gap-2">
                <span class="text-green-500">✓</span>
                <span>Unlimited Stops per Trip</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500">✓</span>
                <span>One-Click Route Optimization</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500">✓</span>
                <span>Unlimited Monthly Trips</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-green-500">✓</span>
                <span>Data Export</span>
            </div>
        </div>

        <div class="flex gap-3 justify-center pt-2">
            <Button variant="outline" on:click={() => showUpgradeModal = false}>
                Maybe Later
            </Button>
            <a href="/dashboard/settings" class="inline-flex items-center justify-center rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
                Upgrade Now
            </a>
        </div>
    </div>
</Modal>

<style>
  /* Use styles from New Trip page for consistency */
  .trip-form { max-width: 1300px; margin: 0 auto; padding: 4px; padding-bottom: 90px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; padding: 0 8px; }
  .page-title { font-size: 28px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 14px; color: #6B7280; display: none; }
  .btn-back { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #6B7280; text-decoration: none; font-size: 14px; }
  .progress-steps { display: flex; align-items: center; justify-content: space-between; margin-bottom: 26px; padding: 0 8px; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 1; }
  .step-circle { width: 42px; height: 42px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; border: 2px solid #fff; }
  .step-item.active .step-circle { background: #FF7F50; color: white; }
  .step-item.completed .step-circle { background: #10B981; color: white; }
  .step-label { font-size: 14px; font-weight: 600; color: #9CA3AF; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 3px; background: #E5E7EB; margin: 0 -4px 22px -4px; position: relative; z-index: 0; }
  .step-line.completed { background: #10B981; }
  .form-card { background: white; border: 1px solid #E5E7EB; border-radius: 18px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; }
  .card-title { font-size: 22px; font-weight: 700; color: #111827; margin: 0; }
  .form-grid { display: flex; flex-direction: column; gap: 24px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 16px; font-weight: 600; color: #374151; }
  .hint { color: #9CA3AF; font-weight: 400; }
  input, textarea { width: 100%; padding: 16px; border: 1px solid #E5E7EB; border-radius: 12px; font-size: 18px; background: white; box-sizing: border-box; }
  input:focus, textarea:focus { outline: none; border-color: #FF7F50; }
  .readonly-field { background: #F9FAFB; padding: 16px; border-radius: 12px; border: 1px solid #E5E7EB; color: #6B7280; font-weight: 500; font-size: 18px; }
  .address-input { padding-top: 20px; padding-bottom: 20px; font-size: 19px; }
  .input-money-wrapper { position: relative; width: 100%; }
  .input-money-wrapper .symbol { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; font-size: 18px; }
  .input-money-wrapper input { padding-left: 36px; }
  .input-money-wrapper.small input { padding: 12px 12px 12px 30px; font-size: 16px; }
  .input-money-wrapper.small .symbol { left: 12px; font-size: 16px; }
  .stops-container { margin: 26px 0; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px; background: #F9FAFB; }
  .stops-header { display: flex; justify-content: space-between; margin-bottom: 18px; align-items: center; }
  .stops-header h3 { font-size: 18px; font-weight: 700; margin: 0; }
  .stops-header .count { font-size: 14px; color: #6B7280; background: #E5E7EB; padding: 5px 12px; border-radius: 10px; }
  .stops-list { display: flex; flex-direction: column; gap: 18px; margin-bottom: 22px; }
  .stop-card { background: white; border: 1px solid #E5E7EB; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 18px; }
  .stop-header { display: flex; justify-content: space-between; align-items: center; }
  .stop-number { background: #FF7F50; color: white; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .stop-actions { display: flex; gap: 18px; align-items: center; color: #9CA3AF; }
  .stop-inputs { display: flex; flex-direction: column; gap: 14px; width: 100%; }
  .stop-inputs.new { display: flex; flex-direction: column; gap: 14px; margin-bottom: 18px; }
  .form-actions { display: flex; gap: 18px; margin-top: 36px; padding-top: 26px; border-top: 1px solid #E5E7EB; }
  .btn-primary, .btn-secondary, .btn-add { flex: 1; padding: 18px; border-radius: 12px; font-weight: 600; font-size: 18px; cursor: pointer; border: none; text-align: center; }
  .btn-primary { background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; }
  .btn-secondary { background: white; border: 1px solid #E5E7EB; color: #374151; }
  .btn-add { background: #2563EB; color: white; margin-top: 14px; font-size: 17px; padding: 16px; }
  .btn-icon { background: none; border: none; font-size: 22px; cursor: pointer; color: #9CA3AF; padding: 6px; }
  .btn-icon.delete:hover { color: #DC2626; }
  .btn-icon.gear { color: #6B7280; font-size: 18px; padding: 4px; transition: color 0.2s; }
  .btn-icon.gear:hover { color: #374151; }
  
  .btn-text { background: none; border: none; color: #2563EB; font-weight: 600; font-size: 16px; cursor: pointer; }
  .btn-small { padding: 12px 18px; border-radius: 8px; border: none; font-weight: 600; font-size: 15px; cursor: pointer; }
  .btn-small.primary { background: #10B981; color: white; }
  .summary-box { background: #ECFDF5; border: 1px solid #A7F3D0; padding: 22px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center; color: #065F46; margin-bottom: 36px; font-size: 18px; }
  .section-group { margin-bottom: 36px; }
  .section-top { display: flex; justify-content: space-between; margin-bottom: 18px; align-items: center; }
  .section-top h3 { font-size: 18px; font-weight: 700; margin: 0; }
  
  .add-row { display: flex; gap: 12px; margin-bottom: 18px; }
  .select-input { flex: 1; padding: 12px; border: 1px solid #E5E7EB; border-radius: 10px; font-size: 16px; background: white; color: #374151; }
  
  .expense-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; border-bottom: 1px solid #F3F4F6; }
  .expense-row .name { font-size: 17px; font-weight: 500; flex: 1; }
  .expense-row .input-money-wrapper { width: 120px; }
  .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 36px; }
  .review-tile { background: #F9FAFB; padding: 18px; border-radius: 14px; border: 1px solid #E5E7EB; }
  .review-tile .review-label { display: block; font-size: 14px; color: #6B7280; text-transform: uppercase; margin-bottom: 4px; }
  .review-tile div { font-weight: 700; font-size: 18px; color: #111827; }
  .financial-summary { background: #F9FAFB; padding: 26px; border-radius: 16px; border: 1px solid #E5E7EB; }
  .financial-summary .row { display: flex; justify-content: space-between; margin-bottom: 14px; font-size: 17px; }
  .financial-summary .row.subheader { font-weight: 700; color: #374151; margin-top: 18px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-bottom: 8px; font-size: 15px; }
  .financial-summary .row.detail { font-size: 15px; color: #6B7280; }
  .financial-summary .row.total-expenses { font-weight: 600; color: #4B5563; border-top: 1px dashed #D1D5DB; padding-top: 8px; }
  .financial-summary .total { border-top: 2px solid #D1D5DB; margin-top: 18px; padding-top: 18px; font-weight: 800; font-size: 20px; }
  .val.positive { color: #059669; }
  .val.negative { color: #DC2626; }
  
  .categories-manager { padding: 4px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid #E5E7EB; }
  .tab-btn { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; font-weight: 600; color: #6B7280; cursor: pointer; transition: all 0.2s; }
  .tab-btn.active { color: #FF7F50; border-bottom-color: #FF7F50; }
  .cat-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; }
  .cat-item { display: flex; align-items: center; gap: 4px; background: #F3F4F6; padding: 4px 4px 4px 10px; border-radius: 20px; border: 1px solid #E5E7EB; }
  .cat-badge { font-size: 13px; font-weight: 500; text-transform: capitalize; padding: 0 4px; }
  .cat-delete { border: none; background: #E5E7EB; color: #6B7280; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
  .cat-delete:hover { background: #EF4444; color: white; }
  .add-cat-form { display: flex; gap: 8px; }
  .add-cat-form .input-field { flex: 1; padding: 10px; border: 1px solid #E5E7EB; border-radius: 8px; }
  .modal-actions .btn-cancel { background: white; border: 1px solid #E5E7EB; color: #374151; padding: 12px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; }

  @media (min-width: 768px) {
    .page-subtitle { display: block; }
    .form-card { padding: 48px; }
    .step-circle { width: 48px; height: 48px; font-size: 20px; }
    .stop-card { flex-direction: row; align-items: center; }
    .stop-inputs { display: grid; grid-template-columns: 1fr 160px; }
    .stop-inputs.new { display: grid; grid-template-columns: 1fr 160px; }
    .form-actions { justify-content: flex-end; }
    .btn-primary, .btn-secondary { flex: 0 0 auto; width: auto; min-width: 160px; }
  }
</style>