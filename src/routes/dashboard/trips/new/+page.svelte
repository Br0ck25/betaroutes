<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy, tick } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';

  export let data;
  $: API_KEY = data.googleMapsApiKey;

  let step = 1;
  let mapLoaded = false;
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  
  let dragItemIndex: number | null = null;
  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];

  onMount(() => {
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);

    if (API_KEY && !window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`;
      script.async = true;
      script.onload = () => {
        mapLoaded = true;
        initMapServices();
      };
      document.head.appendChild(script);
    } else if (window.google) {
      mapLoaded = true;
      initMapServices();
    }

    document.addEventListener('click', handleGlobalClick);
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
        document.removeEventListener('click', handleGlobalClick);
    }
  });

  function handleGlobalClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT') {
        closeAutocompleteDropdown();
    }
  }

  function initMapServices() {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
  }

  function initMap(node: HTMLElement) {
      if (!mapLoaded || !window.google) return;
      map = new google.maps.Map(node, {
          center: { lat: 37.7749, lng: -122.4194 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true
      });
      directionsRenderer?.setMap(map);
      
      if (tripData.startAddress) {
          calculateRoute(false);
      }
      
      return { destroy() { } };
  }

  let tripData = {
    id: crypto.randomUUID(),
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '17:00',
    hoursWorked: 0,
    startAddress: $userSettings.defaultStartAddress || '',
    endAddress: $userSettings.defaultEndAddress || '',
    stops: [] as any[],
    totalMiles: 0,
    estimatedTime: 0, // Minutes
    mpg: $userSettings.defaultMPG || 25,
    gasPrice: $userSettings.defaultGasPrice || 3.50,
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

  // --- Map Logic ---
  let calcTimeout: any;
  $: {
      if (mapLoaded && step === 2) {
          void tripData.startAddress;
          void tripData.endAddress;
          void tripData.stops;
          
          clearTimeout(calcTimeout);
          calcTimeout = setTimeout(() => {
             if (tripData.startAddress) calculateRoute(false);
          }, 800);
      }
  }

  function calculateRoute(optimize = false) {
    if (!mapLoaded || !directionsService) return;
    if (!tripData.startAddress) return;

    if (map && directionsRenderer && directionsRenderer.getMap() !== map) {
        directionsRenderer.setMap(map);
    }
    
    const waypoints = tripData.stops.map(stop => ({
      location: stop.address,
      stopover: true
    }));
    const destination = tripData.endAddress || tripData.startAddress;
    
    if (!destination && waypoints.length === 0) return;

    directionsService.route({
      origin: tripData.startAddress,
      destination: destination,
      waypoints: waypoints,
      optimizeWaypoints: optimize,
      travelMode: google.maps.TravelMode.DRIVING
    }, (result: any, status: any) => {
      if (status === 'OK') {
        directionsRenderer?.setDirections(result);
        const route = result.routes[0];
        
        let totalMeters = 0;
        let totalSeconds = 0;
        
        route.legs.forEach((leg: any) => {
            totalMeters += leg.distance.value;
            totalSeconds += leg.duration.value;
        });
        
        if (step === 2) {
            tripData.totalMiles = Math.round((totalMeters / 1609.34) * 10) / 10;
            tripData.estimatedTime = Math.round(totalSeconds / 60);
        }

        if (optimize && result.routes[0].waypoint_order) {
            const order = result.routes[0].waypoint_order;
            const reorderedStops = order.map((index: number) => tripData.stops[index]);
            tripData.stops = reorderedStops;
        }
      }
    });
  }

  function formatDuration(minutes: number): string {
    if (!minutes) return '0 min';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h} hr ${m} min`;
    return `${m} min`;
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
  function handleDrop(event: DragEvent, dropIndex: number) {
      event.preventDefault();
      if (dragItemIndex === null) return;
      const item = tripData.stops[dragItemIndex];
      const newStops = tripData.stops.filter((_, i) => i !== dragItemIndex);
      newStops.splice(dropIndex, 0, item);
      tripData.stops = newStops;
      dragItemIndex = null;
      calculateRoute(false);
  }

  function addStop() {
    if (!newStop.address) return;
    tripData.stops = [...tripData.stops, { ...newStop, id: crypto.randomUUID() }];
    newStop = { address: '', earnings: 0, notes: '' };
  }
  function removeStop(id: string) { tripData.stops = tripData.stops.filter(s => s.id !== id); }
  
  function addMaintenanceItem(type: string) { 
    tripData.maintenanceItems = [...tripData.maintenanceItems, { id: crypto.randomUUID(), type, cost: 0 }]; 
  }
  function removeMaintenanceItem(id: string) { 
    tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id); 
  }
  
  function addCustomMaintenance() { 
    if (!newMaintenanceItem.trim()) return; 
    const item = newMaintenanceItem.trim();
    addMaintenanceItem(item); 
    if (!maintenanceOptions.includes(item)) {
        maintenanceOptions = [...maintenanceOptions, item];
        localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions));
    }
    newMaintenanceItem = ''; 
    showAddMaintenance = false; 
  }

  function deleteMaintenanceOption(option: string) { 
    if (confirm(`Delete "${option}"?`)) { 
      maintenanceOptions = maintenanceOptions.filter(o => o !== option); 
      localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions)); 
    } 
  }
  
  function addSupplyItem(type: string) { tripData.suppliesItems = [...tripData.suppliesItems, { id: crypto.randomUUID(), type, cost: 0 }]; }
  function removeSupplyItem(id: string) { tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id); }
  
  function addCustomSupply() { 
    if (!newSupplyItem.trim()) return; 
    const item = newSupplyItem.trim();
    addSupplyItem(item); 
    if (!suppliesOptions.includes(item)) {
        suppliesOptions = [...suppliesOptions, item];
        localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions));
    }
    newSupplyItem = ''; 
    showAddSupply = false; 
  }

  function deleteSupplyOption(option: string) { if (confirm(`Delete "${option}"?`)) { suppliesOptions = suppliesOptions.filter(o => o !== option); localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions)); } }
  
  $: {
    if (tripData.totalMiles && tripData.mpg && tripData.gasPrice) {
      const gallons = tripData.totalMiles / tripData.mpg;
      tripData.fuelCost = Math.round(gallons * tripData.gasPrice * 100) / 100;
    } else {
      tripData.fuelCost = 0;
    }
  }
  
  $: totalEarnings = tripData.stops.reduce((sum, stop) => sum + (parseFloat(stop.earnings) || 0), 0);
  $: totalMaintenanceCost = tripData.maintenanceItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalSuppliesCost = tripData.suppliesItems.reduce((sum, item) => sum + (item.cost || 0), 0);
  $: totalCosts = (tripData.fuelCost || 0) + totalMaintenanceCost + totalSuppliesCost;
  $: totalProfit = totalEarnings - totalCosts;
  
  $: {
    if (tripData.startTime && tripData.endTime) {
      const [startHour, startMin] = tripData.startTime.split(':').map(Number);
      const [endHour, endMin] = tripData.endTime.split(':').map(Number);
      let diff = (endHour * 60 + endMin) - (startHour * 60 + startMin);
      if (diff < 0) diff += 24 * 60;
      tripData.hoursWorked = Math.round((diff / 60) * 10) / 10;
    }
  }

  function nextStep() { if (step < 4) step++; }
  function prevStep() { if (step > 1) step--; }
  
  async function saveTrip() {
    const currentUser = $page.data.user || $user;
    let userId = currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id');

    if (!userId) { alert("Authentication error: User ID missing."); return; }
    
    const tripToSave = {
      ...tripData,
      id: tripData.id,
      maintenanceCost: totalMaintenanceCost,
      suppliesCost: totalSuppliesCost,
      netProfit: totalProfit,
      totalMileage: tripData.totalMiles,
      fuelCost: tripData.fuelCost,
      stops: tripData.stops.map((stop, index) => ({
        id: stop.id || crypto.randomUUID(),
        address: stop.address,
        earnings: Number(stop.earnings),
        notes: stop.notes || '',
        order: index
      })),
      destinations: tripData.stops.map(stop => ({
        address: stop.address,
        earnings: stop.earnings,
        notes: stop.notes || ''
      })),
      lastModified: new Date().toISOString()
    };
    try {
      await trips.create(tripToSave, userId);
      goto('/dashboard/trips');
    } catch (err) {
      console.error('Failed to create trip:', err);
      alert('Failed to create trip. Please try again.');
    }
  }
  
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 2
    }).format(amount);
  }
  
  function formatTime12Hour(time24: string): string {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  }
  
  function formatDateLocal(dateString: string): string {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  }
  
  function closeAutocompleteDropdown() {
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }
    const containers = document.querySelectorAll('.pac-container');
    containers.forEach((c) => (c as HTMLElement).style.display = 'none');
  }

  function initAutocomplete(node: HTMLInputElement) {
    if (!window.google) return;
    const ac = new google.maps.places.Autocomplete(node, { types: ['geocode'] });
    ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        node.value = place.formatted_address || '';
        node.dispatchEvent(new Event('input'));
        if(node.id === 'start-address') tripData.startAddress = node.value;
        if(node.id === 'end-address') tripData.endAddress = node.value;
        closeAutocompleteDropdown();
    });
    node.addEventListener('blur', () => {
        setTimeout(closeAutocompleteDropdown, 200);
    });
  }
</script>

<svelte:head>
  <title>New Trip - Go Route Yourself</title>
  <style>
    :global(.pac-container) { 
        z-index: 10000 !important; 
        background: white; 
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); 
        border-radius: 8px; 
        margin-top: 4px; 
        font-family: inherit; 
        border: 1px solid #E5E7EB; 
    }
    :global(.pac-item) {
        padding: 12px;
        font-size: 16px;
        cursor: pointer;
    }
  </style>
</svelte:head>

<div class="trip-form">
  <div class="page-header">
    <div>
      <h1 class="page-title">New Trip</h1>
      <p class="page-subtitle">Plan details & earnings</p>
    </div>
    <a href="/dashboard/trips" class="btn-back">
      <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
        <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Back
    </a>
  </div>
  
  <div class="progress-steps">
    <div class="step-item" class:active={step >= 1} class:completed={step > 1}>
      <div class="step-circle">{step > 1 ? '✓' : '1'}</div>
      <div class="step-label">Basics</div>
    </div>
    <div class="step-line" class:completed={step > 1}></div>
    <div class="step-item" class:active={step >= 2} class:completed={step > 2}>
      <div class="step-circle">{step > 2 ? '✓' : '2'}</div>
      <div class="step-label">Route</div>
    </div>
    <div class="step-line" class:completed={step > 2}></div>
    <div class="step-item" class:active={step >= 3} class:completed={step > 3}>
      <div class="step-circle">{step > 3 ? '✓' : '3'}</div>
      <div class="step-label">Costs</div>
    </div>
    <div class="step-line" class:completed={step > 3}></div>
    <div class="step-item" class:active={step >= 4}>
      <div class="step-circle">4</div>
      <div class="step-label">Review</div>
    </div>
  </div>
  
  <div class="form-content">
    {#if step === 1}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Basic Information</h2>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label for="trip-date">Date</label>
            <input id="trip-date" type="date" bind:value={tripData.date} required />
          </div>
          <div class="form-row">
            <div class="form-group">
                <label for="start-time">Start Time</label>
                <input id="start-time" type="time" bind:value={tripData.startTime} />
            </div>
            <div class="form-group">
                <label for="end-time">End Time</label>
                <input id="end-time" type="time" bind:value={tripData.endTime} />
            </div>
          </div>
          <div class="form-group">
            <label for="hours-display">Hours Worked</label>
            <div id="hours-display" class="readonly-field">{tripData.hoursWorked.toFixed(1)} hours</div>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-primary full-width" on:click={nextStep} type="button">Continue</button>
        </div>
      </div>
    {/if}
    
    {#if step === 2}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Route & Stops</h2>
          <button class="btn-optimize" on:click={() => calculateRoute(true)}>Optimize</button>
        </div>
        
        <div class="form-group">
          <label for="start-address">Starting Address</label>
          <input type="text" bind:value={tripData.startAddress} placeholder="Enter start address..." use:initAutocomplete id="start-address" class="address-input" />
        </div>
        
        <div class="stops-container">
          <div class="stops-header">
            <h3>Stops</h3>
            <span class="count">{tripData.stops.length} added</span>
          </div>
          
          {#if tripData.stops.length > 0}
            <div class="stops-list">
              {#each tripData.stops as stop, i (stop.id)}
                <div 
                  class="stop-card" 
                  draggable="true" 
                  on:dragstart={(e) => handleDragStart(e, i)} 
                  on:drop={(e) => handleDrop(e, i)} 
                  on:dragover={handleDragOver}
                  role="listitem"
                >
                  <div class="stop-header">
                    <div class="stop-number">{i + 1}</div>
                    <div class="stop-actions">
                        <button class="btn-icon delete" on:click={() => removeStop(stop.id)} type="button">✕</button>
                        <div class="drag-handle">☰</div>
                    </div>
                  </div>
                  <div class="stop-inputs">
                    <input type="text" class="address-input" bind:value={stop.address} placeholder="Address" use:initAutocomplete />
                    <div class="input-money-wrapper">
                        <span class="symbol">$</span>
                        <input type="number" class="input-money" bind:value={stop.earnings} placeholder="Earnings" step="0.01" min="0" />
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          
          <div class="add-stop-form">
            <div class="stop-inputs new">
                <input type="text" class="address-input" placeholder="New stop address..." bind:value={newStop.address} use:initAutocomplete />
                <div class="input-money-wrapper">
                    <span class="symbol">$</span>
                    <input type="number" class="input-money" placeholder="0.00" bind:value={newStop.earnings} step="0.01" min="0" />
                </div>
            </div>
            <button class="btn-add full-width" on:click={addStop} type="button">+ Add Stop</button>
          </div>
        </div>
        
        <div class="form-group">
          <label for="end-address">End Address (Optional)</label>
          <input type="text" bind:value={tripData.endAddress} placeholder="Same as start if empty" use:initAutocomplete id="end-address" class="address-input" />
        </div>

        <div class="map-wrapper" use:initMap></div>

        <div class="form-row">
            <div class="form-group">
                <label for="total-miles">Total Miles <span class="hint">(Auto)</span></label>
                <input id="total-miles" type="number" bind:value={tripData.totalMiles} step="0.1" min="0" />
            </div>
            <div class="form-group">
                <label for="drive-time">Drive Time <span class="hint">(Est)</span></label>
                <div id="drive-time" class="readonly-field">{formatDuration(tripData.estimatedTime)}</div>
            </div>
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">Back</button>
          <button class="btn-primary" on:click={nextStep} type="button">Continue</button>
        </div>
      </div>
    {/if}
    
    {#if step === 3}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Costs</h2>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="mpg">MPG</label>
                <input id="mpg" type="number" bind:value={tripData.mpg} step="0.1" />
            </div>
            <div class="form-group">
                <label for="gas-price">Gas Price</label>
                <div class="input-money-wrapper">
                    <span class="symbol">$</span>
                    <input id="gas-price" type="number" bind:value={tripData.gasPrice} step="0.01" />
                </div>
            </div>
        </div>
        
        <div class="summary-box" style="margin: 40px 0;">
            <span>Estimated Fuel Cost</span>
            <strong>{formatCurrency(tripData.fuelCost)}</strong>
        </div>
        
        <div class="section-group">
            <div class="section-top">
                <h3>Maintenance</h3>
                <button class="btn-text" on:click={() => showAddMaintenance = !showAddMaintenance}>+ Custom</button>
            </div>
            
            {#if showAddMaintenance}
                <div class="add-custom-row">
                    <input type="text" bind:value={newMaintenanceItem} placeholder="Item name..." />
                    <button class="btn-small primary" on:click={addCustomMaintenance}>Add</button>
                </div>
            {/if}
            
            <div class="chips-row">
                {#each maintenanceOptions as option}
                    <div class="option-badge">
                        <button class="badge-btn" on:click={() => addMaintenanceItem(option)}>{option}</button>
                        <button class="badge-delete" on:click={() => deleteMaintenanceOption(option)}>✕</button>
                    </div>
                {/each}
            </div>
            
            {#each tripData.maintenanceItems as item}
                <div class="expense-row">
                    <span class="name">{item.type}</span>
                    <div class="input-money-wrapper small">
                        <span class="symbol">$</span>
                        <input type="number" bind:value={item.cost} placeholder="0.00" />
                    </div>
                    <button class="btn-icon delete" on:click={() => removeMaintenanceItem(item.id)}>✕</button>
                </div>
            {/each}
        </div>

        <div class="section-group">
            <div class="section-top">
                <h3>Supplies</h3>
                <button class="btn-text" on:click={() => showAddSupply = !showAddSupply}>+ Custom</button>
            </div>
            
            {#if showAddSupply}
                <div class="add-custom-row">
                    <input type="text" bind:value={newSupplyItem} placeholder="Item name..." />
                    <button class="btn-small primary" on:click={addCustomSupply}>Add</button>
                </div>
            {/if}
            
            <div class="chips-row">
                {#each suppliesOptions as option}
                    <div class="option-badge">
                        <button class="badge-btn" on:click={() => addSupplyItem(option)}>{option}</button>
                        <button class="badge-delete" on:click={() => deleteSupplyOption(option)}>✕</button>
                    </div>
                {/each}
            </div>
            
            {#each tripData.suppliesItems as item}
                <div class="expense-row">
                    <span class="name">{item.type}</span>
                    <div class="input-money-wrapper small">
                        <span class="symbol">$</span>
                        <input type="number" bind:value={item.cost} placeholder="0.00" />
                    </div>
                    <button class="btn-icon delete" on:click={() => removeSupplyItem(item.id)}>✕</button>
                </div>
            {/each}
        </div>
        
        <div class="form-group">
            <label for="notes">Notes</label>
            <textarea id="notes" bind:value={tripData.notes} rows="3" placeholder="Trip details..."></textarea>
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">Back</button>
          <button class="btn-primary" on:click={nextStep} type="button">Review</button>
        </div>
      </div>
    {/if}
    
    {#if step === 4}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Review</h2>
        </div>
        
        <div class="review-grid">
            <div class="review-tile">
                <span class="review-label">Date</span>
                <div>{formatDateLocal(tripData.date)}</div>
            </div>
            <div class="review-tile">
                <span class="review-label">Total Time</span>
                <div>{tripData.hoursWorked.toFixed(1)} hrs</div>
            </div>
            <div class="review-tile">
                <span class="review-label">Drive Time</span>
                <div>{formatDuration(tripData.estimatedTime)}</div>
            </div>
            <div class="review-tile">
                <span class="review-label">Hours Worked</span>
                <div>{Math.max(0, tripData.hoursWorked - (tripData.estimatedTime / 60)).toFixed(1)} hrs</div>
            </div>
            <div class="review-tile">
                <span class="review-label">Distance</span>
                <div>{tripData.totalMiles} mi</div>
            </div>
            <div class="review-tile">
                <span class="review-label">Stops</span>
                <div>{tripData.stops.length}</div>
            </div>
        </div>
        
        <div class="financial-summary">
            <div class="row"><span>Earnings</span> <span class="val positive">{formatCurrency(totalEarnings)}</span></div>
            
            <div class="row subheader"><span>Expenses Breakdown</span></div>
            
            {#if tripData.fuelCost > 0}
               <div class="row detail"><span>Fuel</span> <span class="val">{formatCurrency(tripData.fuelCost)}</span></div>
            {/if}

            {#each tripData.maintenanceItems as item}
                <div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>
            {/each}

            {#each tripData.suppliesItems as item}
                <div class="row detail"><span>{item.type}</span> <span class="val">{formatCurrency(item.cost)}</span></div>
            {/each}

            <div class="row total-expenses"><span>Total Expenses</span> <span class="val negative">-{formatCurrency(totalCosts)}</span></div>
            
            <div class="row total"><span>Net Profit</span> <span class="val" class:positive={totalProfit >= 0}>{formatCurrency(totalProfit)}</span></div>
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">Back</button>
          <button class="btn-primary" on:click={saveTrip} type="button">Save Trip</button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Mobile-First - MAX WIDTH INCREASED, PADDING REDUCED to 4px for edge-to-edge look */
  .trip-form { max-width: 1300px; margin: 0 auto; padding: 4px; padding-bottom: 90px; }
  
  /* Header */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; padding: 0 8px; }
  .page-title { font-size: 28px; font-weight: 800; color: #111827; margin: 0; }
  .page-subtitle { font-size: 16px; color: #6B7280; display: none; }
  .btn-back { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #6B7280; text-decoration: none; font-size: 16px; }

  /* Stepper */
  .progress-steps { display: flex; align-items: center; justify-content: space-between; margin-bottom: 26px; padding: 0 8px; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 1; }
  .step-circle { width: 42px; height: 42px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; border: 2px solid #fff; }
  .step-item.active .step-circle { background: #FF7F50; color: white; }
  .step-item.completed .step-circle { background: #10B981; color: white; }
  .step-label { font-size: 14px; font-weight: 600; color: #9CA3AF; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 3px; background: #E5E7EB; margin: 0 -4px 22px -4px; position: relative; z-index: 0; }
  .step-line.completed { background: #10B981; }

  /* Forms - PADDING REDUCED to 16px */
  .form-card { background: white; border: 1px solid #E5E7EB; border-radius: 18px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; }
  .card-title { font-size: 22px; font-weight: 700; color: #111827; margin: 0; }
  
  .form-grid { display: flex; flex-direction: column; gap: 24px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 16px; font-weight: 600; color: #374151; }
  .hint { color: #9CA3AF; font-weight: 400; }
  
  /* Inputs Enlarged */
  input, textarea { width: 100%; padding: 16px; border: 1px solid #E5E7EB; border-radius: 12px; font-size: 18px; background: white; box-sizing: border-box; }
  input:focus, textarea:focus { outline: none; border-color: #FF7F50; }
  .readonly-field { background: #F9FAFB; padding: 16px; border-radius: 12px; border: 1px solid #E5E7EB; color: #6B7280; font-weight: 500; font-size: 18px; }

  /* Specific class to increase height of address inputs */
  .address-input { 
      padding-top: 20px; 
      padding-bottom: 20px; 
      font-size: 19px; 
  }

  /* Input Money Wrapper */
  .input-money-wrapper { position: relative; width: 100%; }
  .input-money-wrapper .symbol { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; font-size: 18px; }
  .input-money-wrapper input { padding-left: 36px; }
  .input-money-wrapper.small input { padding: 12px 12px 12px 30px; font-size: 16px; }
  .input-money-wrapper.small .symbol { left: 12px; font-size: 16px; }

  /* Stops - Improved Mobile Layout */
  .stops-container { margin: 26px 0; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px; background: #F9FAFB; }
  .stops-header { display: flex; justify-content: space-between; margin-bottom: 18px; align-items: center; }
  .stops-header h3 { font-size: 18px; font-weight: 700; margin: 0; }
  .stops-header .count { font-size: 14px; color: #6B7280; background: #E5E7EB; padding: 5px 12px; border-radius: 10px; }
  
  .stops-list { display: flex; flex-direction: column; gap: 18px; margin-bottom: 22px; }
  .stop-card { background: white; border: 1px solid #E5E7EB; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 18px; }
  .stop-header { display: flex; justify-content: space-between; align-items: center; }
  .stop-number { background: #FF7F50; color: white; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .stop-actions { display: flex; gap: 18px; align-items: center; color: #9CA3AF; }
  
  /* Stops Inputs Grid - Optimized for Mobile */
  .stop-inputs { display: flex; flex-direction: column; gap: 14px; width: 100%; }
  .stop-inputs.new { display: flex; flex-direction: column; gap: 14px; margin-bottom: 18px; }
  
  /* Buttons Enlarged */
  .form-actions { display: flex; gap: 18px; margin-top: 36px; padding-top: 26px; border-top: 1px solid #E5E7EB; }
  .btn-primary, .btn-secondary, .btn-add { flex: 1; padding: 18px; border-radius: 12px; font-weight: 600; font-size: 18px; cursor: pointer; border: none; text-align: center; }
  .btn-primary { background: linear-gradient(135deg, #FF7F50 0%, #FF6A3D 100%); color: white; }
  .btn-secondary { background: white; border: 1px solid #E5E7EB; color: #374151; }
  .btn-add { background: #2563EB; color: white; margin-top: 14px; font-size: 17px; padding: 16px; }
  .btn-optimize { background: #EFF6FF; color: #2563EB; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 15px; cursor: pointer; }
  .btn-icon { background: none; border: none; font-size: 22px; cursor: pointer; color: #9CA3AF; padding: 6px; }
  .btn-icon.delete:hover { color: #DC2626; }
  .btn-text { background: none; border: none; color: #2563EB; font-weight: 600; font-size: 16px; cursor: pointer; }
  .btn-small { padding: 12px 18px; border-radius: 8px; border: none; font-weight: 600; font-size: 15px; cursor: pointer; }
  .btn-small.primary { background: #10B981; color: white; }

  /* Map */
  .map-wrapper { height: 280px; background: #E5E7EB; border-radius: 14px; margin: 26px 0; }

  /* Costs & Summary */
  .summary-box { background: #ECFDF5; border: 1px solid #A7F3D0; padding: 22px; border-radius: 14px; display: flex; justify-content: space-between; align-items: center; color: #065F46; margin-bottom: 36px; font-size: 18px; }
  
  .section-group { margin-bottom: 36px; }
  .section-top { display: flex; justify-content: space-between; margin-bottom: 18px; align-items: center; }
  .section-top h3 { font-size: 18px; font-weight: 700; margin: 0; }
  
  .add-custom-row { display: flex; gap: 14px; margin-bottom: 18px; }
  .add-custom-row input { flex: 1; padding: 14px; }
  
  /* Restored Badge Style */
  .chips-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
  .option-badge { display: inline-flex; align-items: stretch; background: white; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; }
  .badge-btn { padding: 10px 14px; border: none; background: transparent; font-size: 15px; font-weight: 500; color: #4B5563; cursor: pointer; border-right: 1px solid #E5E7EB; }
  .badge-btn:hover { background: #F9FAFB; color: #FF7F50; }
  .badge-delete { padding: 0 10px; border: none; background: #FEF2F2; color: #DC2626; cursor: pointer; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .badge-delete:hover { background: #FCA5A5; color: white; }

  .expense-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; border-bottom: 1px solid #F3F4F6; }
  .expense-row .name { font-size: 17px; font-weight: 500; flex: 1; }
  .expense-row .input-money-wrapper { width: 120px; }

  /* Review */
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

  /* Desktop Upgrades */
  @media (min-width: 768px) {
    .page-subtitle { display: block; }
    .form-card { padding: 48px; }
    .step-circle { width: 48px; height: 48px; font-size: 20px; }
    .stop-card { flex-direction: row; align-items: center; }
    /* Desktop layout for stops: Address gets 75% of space */
    .stop-inputs { display: grid; grid-template-columns: 1fr 160px; }
    .stop-inputs.new { display: grid; grid-template-columns: 1fr 160px; }
    .form-actions { justify-content: flex-end; }
    .btn-primary, .btn-secondary { flex: 0 0 auto; width: auto; min-width: 160px; }
  }
</style>