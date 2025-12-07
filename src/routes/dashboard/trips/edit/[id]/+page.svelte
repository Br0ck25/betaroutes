<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';

export let data;
  $: API_KEY = data.googleMapsApiKey;
  const tripId = $page.params.id; // Get ID from URL

  let step = 1;
  let loading = true; // Add loading state
  let mapLoaded = false;
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  
  // Drag state
  let dragItemIndex: number | null = null;

  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];

onMount(async () => {
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);

    // Load existing trip data
    await loadTripData();

    console.log('[EDIT TRIP] Loading Maps...');

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
  });

  // NEW FUNCTION: Fetch existing data
  async function loadTripData() {
    let userId = $user?.token || localStorage.getItem('offline_user_id');
    
    if (!$trips || $trips.length === 0) {
        if (userId) await trips.load(userId);
    }

    const found = $trips.find(t => t.id === tripId);
    
    if (!found) {
        alert('Trip not found');
        goto('/dashboard/trips');
        return;
    }

    // Populate form with existing data
    tripData = {
        ...JSON.parse(JSON.stringify(found)),
        stops: found.stops || [],
        maintenanceItems: found.maintenanceItems || [],
        suppliesItems: found.suppliesItems || [],
        totalMiles: Number(found.totalMiles) || 0,
        mpg: Number(found.mpg) || 25,
        gasPrice: Number(found.gasPrice) || 3.50,
        fuelCost: Number(found.fuelCost) || 0,
        hoursWorked: Number(found.hoursWorked) || 0
    };

    // If we have an address, trigger map logic later
    if (tripData.startAddress) {
        setTimeout(() => calculateRoute(false), 500);
    }

    loading = false;
  }

  // Action to initialize map on DOM element
  function initMap(node: HTMLElement) {
      if (!mapLoaded || !window.google) return;
      
      map = new google.maps.Map(node, {
          center: { lat: 37.7749, lng: -122.4194 },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true
      });
      directionsRenderer?.setMap(map);
      
      // Auto-calculate if data exists
      if (tripData.startAddress) {
          calculateRoute(false);
      }
      
      return {
          destroy() {
             // cleanup
          }
      };
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
    estimatedTime: 0,
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
    
    // Ensure map is linked
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
        route.legs.forEach((leg: any) => totalMeters += leg.distance.value);
        if (step === 2) {
            tripData.totalMiles = Math.round((totalMeters / 1609.34) * 10) / 10;
        }

        if (optimize && result.routes[0].waypoint_order) {
            const order = result.routes[0].waypoint_order;
            const reorderedStops = order.map((index: number) => tripData.stops[index]);
            tripData.stops = reorderedStops;
        }
      }
    });
  }

  // --- Drag & Drop ---
  function handleDragStart(event: DragEvent, index: number) {
      dragItemIndex = index;
      if(event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.dropEffect = 'move';
          event.dataTransfer.setData('text/plain', index.toString());
      }
  }
  function handleDragOver(event: DragEvent) {
      event.preventDefault(); return false;
  }
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
  
  function removeStop(id: string) {
    tripData.stops = tripData.stops.filter(s => s.id !== id);
  }
  
  function addMaintenanceItem(type: string) {
    tripData.maintenanceItems = [...tripData.maintenanceItems, { id: crypto.randomUUID(), type, cost: 0 }];
  }
  function removeMaintenanceItem(id: string) {
    tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id);
  }
  function addCustomMaintenance() {
    if (!newMaintenanceItem.trim()) return;
    addMaintenanceItem(newMaintenanceItem.trim());
    newMaintenanceItem = '';
    showAddMaintenance = false;
  }
  function deleteMaintenanceOption(option: string) {
    if (confirm(`Delete "${option}"?`)) {
      maintenanceOptions = maintenanceOptions.filter(o => o !== option);
      localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions));
    }
  }
  function addSupplyItem(type: string) {
    tripData.suppliesItems = [...tripData.suppliesItems, { id: crypto.randomUUID(), type, cost: 0 }];
  }
  function removeSupplyItem(id: string) {
    tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id);
  }
  function addCustomSupply() {
    if (!newSupplyItem.trim()) return;
    addSupplyItem(newSupplyItem.trim());
    newSupplyItem = '';
    showAddSupply = false;
  }
  function deleteSupplyOption(option: string) {
    if (confirm(`Delete "${option}"?`)) {
      suppliesOptions = suppliesOptions.filter(o => o !== option);
      localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions));
    }
  }
  
  // --- Calc ---
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
    let userId = $page.data.user?.token || $user?.token || localStorage.getItem('offline_user_id');
    
    if (!userId) {
        alert("Authentication error: User ID missing.");
        return;
    }
    
    const tripToSave = {
      ...tripData,
      // Keep existing ID
      id: tripId, 
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
      updatedAt: new Date().toISOString() // Update timestamp
    };

    try {
      // CALL UPDATE INSTEAD OF CREATE
      await trips.updateTrip(tripId, tripToSave, userId);
      alert('Trip updated successfully!');
      goto('/dashboard/trips');
    } catch (err) {
      console.error('Failed to update trip:', err);
      alert('Failed to update trip. Please try again.');
    }
  }
  
  function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
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
  
  function initAutocomplete(node: HTMLInputElement) {
    if (!window.google) return;
    const ac = new google.maps.places.Autocomplete(node, { types: ['geocode'] });
    ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        node.value = place.formatted_address || '';
        node.dispatchEvent(new Event('input'));
        if(node.id === 'start-address') tripData.startAddress = node.value;
        if(node.id === 'end-address') tripData.endAddress = node.value;
    });
  }
</script>

<svelte:head>
  <title>New Trip - Go Route Yourself</title>
  <style>
    .pac-container { z-index: 10000 !important; background: white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3); border-radius: 8px; margin-top: 2px; font-family: inherit;
    }
  </style>
</svelte:head>

<div class="trip-form">
  <div class="page-header">
    <div>
      <h1 class="page-title">Edit Trip</h1>
      <p class="page-subtitle">Plan your route and track earnings</p>
    </div>
    <a href="/dashboard/trips" class="btn-back">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Back
    </a>
  </div>
  
  <div class="progress-steps">
    <div class="step-item" class:active={step >= 1} class:completed={step > 1}>
      <div class="step-circle">
        {#if step > 1}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          1
        {/if}
      </div>
      <div class="step-label">Basic Info</div>
    </div>
    
    <div class="step-line" class:completed={step > 1}></div>
    
    <div class="step-item" class:active={step >= 2} class:completed={step > 2}>
      <div class="step-circle">
        {#if step > 2}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          2
        {/if}
      </div>
      <div class="step-label">Route & Stops</div>
    </div>
    
    <div class="step-line" class:completed={step > 2}></div>
    
    <div class="step-item" class:active={step >= 3} class:completed={step > 3}>
      <div class="step-circle">
        {#if step > 3}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 4L6 11L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {:else}
          3
        {/if}
      </div>
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
          <p class="card-subtitle">When did your trip take place?</p>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Date</label>
            <input type="date" bind:value={tripData.date} required />
          </div>
          <div class="form-group">
            <label>Start Time</label>
            <input type="time" bind:value={tripData.startTime} />
          </div>
          <div class="form-group">
            <label>End Time</label>
            <input type="time" bind:value={tripData.endTime} />
          </div>
          <div class="form-group">
            <label>Hours Worked</label>
            <div class="hours-display-field">{tripData.hoursWorked.toFixed(1)} hours</div>
            <small class="field-hint">Auto-calculated from start and end time</small>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-primary" on:click={nextStep} type="button">
            Continue
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}
    
    {#if step === 2}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Route & Stops</h2>
          <button class="btn-optimize" on:click={() => calculateRoute(true)}>
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linecap="round" stroke-linejoin="round"/>
             </svg>
             Optimize
          </button>
        </div>
        <div class="form-group">
          <label>Starting Address</label>
          <input 
            type="text" 
            bind:value={tripData.startAddress}
            placeholder="Start typing address..."
            use:initAutocomplete
            id="start-address"
          />
        </div>
        <div class="form-group">
          <label>End Address (if different from start)</label>
          <input 
            type="text" 
            bind:value={tripData.endAddress}
            placeholder="Start typing address..."
            use:initAutocomplete
            id="end-address"
          />
        </div>
        
        <div class="stops-section">
          <div class="section-header">
            <h3>Stops & Earnings</h3>
            <p>Add each stop along your route</p>
          </div>
          {#if tripData.stops.length > 0}
            <div class="stops-list">
              {#each tripData.stops as stop, i (stop.id)}
                <div 
                    class="stop-item" 
                    draggable="true" 
                    on:dragstart={(e) => handleDragStart(e, i)}
                    on:drop={(e) => handleDrop(e, i)}
                    on:dragover={handleDragOver}
                >
                  <div class="stop-grip" title="Drag to reorder">⋮⋮</div>
                  <div class="stop-number">{i + 1}</div>
                  
                  <div class="stop-info">
                    <input 
                      type="text"
                      class="stop-address-input"
                      bind:value={stop.address}
                      placeholder="Stop address"
                      use:initAutocomplete
                    />
                  </div>
                  
                  <div class="stop-earnings-input">
                    <span class="currency">$</span>
                    <input 
                      type="number"
                      bind:value={stop.earnings}
                      placeholder="0"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  
                  <button class="stop-delete" on:click={() => removeStop(stop.id)} type="button">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="add-stop">
            <input 
              type="text" 
              placeholder="Stop address"
              bind:value={newStop.address}
              use:initAutocomplete
            />
            <input 
              type="number" 
              placeholder="Earnings ($)"
              bind:value={newStop.earnings}
              step="0.01"
              min="0"
            />
            <button class="btn-add" on:click={addStop} type="button">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 4V16M4 10H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              Add Stop
            </button>
          </div>
        </div>
        
        <div class="map-container" use:initMap></div>

        <div class="form-group">
          <label>
            Total Miles 
            <span class="label-hint">(auto-calculated, editable)</span>
          </label>
          <input 
            type="number" 
            bind:value={tripData.totalMiles}
            placeholder="0.0"
            step="0.1"
            min="0"
          />
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Back
          </button>
          <button class="btn-primary" on:click={nextStep} type="button">
            Continue
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}
    
    {#if step === 3}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Costs & Expenses</h2>
          <p class="card-subtitle">Track all your trip expenses</p>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Vehicle MPG</label>
            <input 
              type="number" 
              bind:value={tripData.mpg}
              step="0.1"
              min="0"
            />
          </div>
          <div class="form-group">
            <label>Gas Price (per gallon)</label>
            <div class="input-prefix">
              <span>$</span>
              <input 
                type="number" 
                bind:value={tripData.gasPrice}
                step="0.01"
                min="0"
              />
            </div>
          </div>
        </div>
        
        <div class="cost-summary">
          <div class="cost-item">
            <span>Fuel Cost (calculated)</span>
            <span class="cost-value">{formatCurrency(tripData.fuelCost)}</span>
          </div>
        </div>
        
        <div class="expenses-section">
          <div class="section-header">
            <h3>Maintenance Costs</h3>
            <div class="header-actions">
              <button class="btn-add-custom" on:click={() => showAddMaintenance = !showAddMaintenance} type="button">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Add Custom
              </button>
            </div>
          </div>
          {#if showAddMaintenance}
            <div class="custom-input-row">
              <input 
                type="text" 
                bind:value={newMaintenanceItem}
                placeholder="Enter custom maintenance item..."
              />
              <button class="btn-save" on:click={addCustomMaintenance} type="button">Save</button>
              <button class="btn-cancel" on:click={() => showAddMaintenance = false} type="button">Cancel</button>
            </div>
          {/if}
          <div class="options-grid">
            {#each maintenanceOptions as option}
              <div class="option-badge">
                <button class="badge-btn" on:click={() => addMaintenanceItem(option)} type="button">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {option}
                </button>
                <button class="badge-delete" on:click={() => deleteMaintenanceOption(option)} type="button">×</button>
              </div>
            {/each}
          </div>
          {#if tripData.maintenanceItems.length > 0}
            <div class="expense-items">
              {#each tripData.maintenanceItems as item}
                <div class="expense-item">
                  <span class="expense-type">{item.type}</span>
                  
                  <div class="expense-input">
                    <span class="currency">$</span>
                    <input 
                      type="number" 
                      bind:value={item.cost}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                  
                  <button class="expense-delete" on:click={() => removeMaintenanceItem(item.id)} type="button">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
                      <path d="M12 4L4 12M4 4L12 12" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    Remove
                  </button>
                </div>
              {/each}
              <div class="expense-total">
                <span>Total Maintenance</span>
                <span class="total-amount">{formatCurrency(totalMaintenanceCost)}</span>
              </div>
            </div>
          {/if}
        </div>
        
        <div class="expenses-section">
          <div class="section-header">
            <h3>Supplies Costs</h3>
            <div class="header-actions">
              <button class="btn-add-custom" on:click={() => showAddSupply = !showAddSupply} type="button">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Add Custom
              </button>
            </div>
          </div>
          {#if showAddSupply}
            <div class="custom-input-row">
              <input 
                type="text" 
                bind:value={newSupplyItem}
                placeholder="Enter custom supply item..."
              />
              <button class="btn-save" on:click={addCustomSupply} type="button">Save</button>
              <button class="btn-cancel" on:click={() => showAddSupply = false} type="button">Cancel</button>
            </div>
          {/if}
          <div class="options-grid">
            {#each suppliesOptions as option}
              <div class="option-badge">
                <button class="badge-btn" on:click={() => addSupplyItem(option)} type="button">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                  {option}
                </button>
                <button class="badge-delete" on:click={() => deleteSupplyOption(option)} type="button">×</button>
              </div>
            {/each}
          </div>
          {#if tripData.suppliesItems.length > 0}
            <div class="expense-items">
              {#each tripData.suppliesItems as item}
                <div class="expense-item">
                  <span class="expense-type">{item.type}</span>
                  <div class="expense-input">
                    <span class="currency">$</span>
                    <input 
                      type="number" 
                      bind:value={item.cost}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                  <button class="expense-delete" on:click={() => removeSupplyItem(item.id)} type="button">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
                      <path d="M12 4L4 12M4 4L12 12" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    Remove
                  </button>
                </div>
              {/each}
              <div class="expense-total">
                <span>Total Supplies</span>
                <span class="total-amount">{formatCurrency(totalSuppliesCost)}</span>
              </div>
            </div>
          {/if}
        </div>
        
        <div class="form-group">
          <label>Notes (optional)</label>
          <textarea 
            bind:value={tripData.notes}
            placeholder="Add any additional notes about this trip..."
            rows="4"
          ></textarea>
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Back
          </button>
          <button class="btn-primary" on:click={nextStep} type="button">
            Review Trip
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    {/if}
    
    {#if step === 4}
      <div class="form-card">
        <div class="card-header">
          <h2 class="card-title">Review & Save</h2>
          <p class="card-subtitle">Confirm your trip details</p>
        </div>
        
        <div class="review-section">
          <h3 class="review-title">Trip Summary</h3>
          <div class="review-grid">
            <div class="review-item">
              <span class="review-label">Date</span>
              <span class="review-value">{formatDateLocal(tripData.date)}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Time</span>
              <span class="review-value">{formatTime12Hour(tripData.startTime)} - {formatTime12Hour(tripData.endTime)}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Hours Worked</span>
              <span class="review-value">{tripData.hoursWorked || 0} hours</span>
            </div>
            <div class="review-item">
              <span class="review-label">Total Miles</span>
              <span class="review-value">{tripData.totalMiles} mi</span>
            </div>
            <div class="review-item">
              <span class="review-label">Number of Stops</span>
              <span class="review-value">{tripData.stops.length}</span>
            </div>
          </div>
        </div>
        
        <div class="review-section">
          <h3 class="review-title">Financial Summary</h3>
          <div class="financial-summary">
            <div class="summary-row">
              <span>Total Earnings</span>
              <span class="amount positive">{formatCurrency(totalEarnings)}</span>
            </div>
            <div class="summary-row">
              <span>Fuel Cost</span>
              <span class="amount">{formatCurrency(tripData.fuelCost)}</span>
            </div>
            <div class="summary-row">
              <span>Maintenance ({tripData.maintenanceItems.length} items)</span>
              <span class="amount">{formatCurrency(totalMaintenanceCost)}</span>
            </div>
            <div class="summary-row">
              <span>Supplies ({tripData.suppliesItems.length} items)</span>
              <span class="amount">{formatCurrency(totalSuppliesCost)}</span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-row total">
              <span>Net Profit</span>
              <span class="amount" class:positive={totalProfit >= 0} class:negative={totalProfit < 0}>
                {formatCurrency(totalProfit)}
              </span>
            </div>
            {#if tripData.hoursWorked > 0}
              <div class="summary-row hourly">
                <span>Hourly Pay</span>
                <span class="amount positive">
                  {formatCurrency(totalProfit / tripData.hoursWorked)}/hr
                </span>
              </div>
            {/if}
          </div>
        </div>
        
        <div class="form-actions">
          <button class="btn-secondary" on:click={prevStep} type="button">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Back
          </button>
          <button class="btn-primary" on:click={saveTrip} type="button">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M16.6 5L7.5 14L3.4 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Save Trip
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .trip-form { max-width: 900px; margin: 0 auto; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  .btn-back { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: white; color: #6B7280; border: 2px solid #E5E7EB; border-radius: 10px; font-weight: 600; text-decoration: none; transition: all 0.2s; }
  .btn-back:hover { border-color: var(--orange); color: var(--orange); }
  
  .progress-steps { display: flex; align-items: center; margin-bottom: 40px; padding: 24px; background: white; border: 1px solid #E5E7EB; border-radius: 16px; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; }
  .step-circle { width: 48px; height: 48px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; transition: all 0.3s; }
  .step-item.active .step-circle { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3); }
  .step-item.completed .step-circle { background: var(--green); color: white; }
  .step-label { font-size: 13px; font-weight: 600; color: #9CA3AF; text-align: center; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 2px; background: #E5E7EB; margin: 0 16px; transition: all 0.3s; }
  .step-line.completed { background: var(--green); }
  
  .form-content { margin-bottom: 32px; }
  .form-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 32px; }
  .card-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #E5E7EB; display: flex; justify-content: space-between; align-items: center; }
  .card-title { font-size: 24px; font-weight: 700; color: #111827; margin: 0; }
  .card-subtitle { font-size: 15px; color: #6B7280; }
  
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 24px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  .form-group label { font-size: 14px; font-weight: 600; color: #374151; }
  .label-hint { font-size: 12px; font-weight: 400; color: #9CA3AF; }
  .field-hint { display: block; margin-top: 6px; font-size: 12px; color: #6B7280; font-style: italic; }
  .hours-display-field { padding: 14px 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-weight: 600; color: #059669; }
  
  .form-group input, .form-group textarea { padding: 14px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; background: white; transition: all 0.2s; }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  
  /* FIX: Ensure input-prefix (Gas Price container) fills width to match MPG input */
  .input-prefix { position: relative; width: 86%; }
  .input-prefix span { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; width: 100%; }
  textarea { resize: vertical; min-height: 100px; }
  
  .stops-section, .expenses-section { margin: 32px 0; padding: 24px; background: #F9FAFB; border-radius: 12px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .section-header h3 { font-size: 16px; font-weight: 700; color: #111827; margin: 0; }
  .section-header p { font-size: 14px; color: #6B7280; }
  .header-actions { display: flex; gap: 8px; }
  
  .btn-add-custom { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: white; color: var(--blue); border: 2px solid var(--blue); border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-add-custom:hover { background: var(--blue); color: white; }
  
  .btn-optimize { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-optimize:hover { background: #bae6fd; }

  .custom-input-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .custom-input-row input { flex: 1; padding: 10px 14px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-family: inherit; }
  .btn-save { padding: 10px 16px; background: var(--green); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-cancel { padding: 10px 16px; background: white; color: #6B7280; border: 2px solid #E5E7EB; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; }
  
  .options-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .option-badge { position: relative; display: inline-flex; }
  .badge-btn { display: flex; align-items: center; gap: 6px; padding: 8px 28px 8px 12px; background: white; color: #374151; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .badge-btn:hover { border-color: var(--orange); color: var(--orange); }
  .badge-delete { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; background: #FEE2E2; color: #DC2626; border: none; border-radius: 4px; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s; line-height: 1; }
  .badge-delete:hover { background: #FCA5A5; }
  
  .expense-items { background: white; border: 1px solid #E5E7EB; border-radius: 10px; padding: 16px; }
  .expense-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F3F4F6; }
  .expense-item:last-of-type { border-bottom: none; }
  .expense-type { flex: 1; font-size: 14px; font-weight: 600; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  
  /* FIX: Ensure dollar input and delete button have fixed widths and don't shrink */
  .expense-input { position: relative; width: 75px; flex-shrink: 0; margin-right: 45px;}
  .expense-input .currency { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .expense-input input { width: 100%; padding: 8px 12px 8px 28px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-family: inherit; }
  
  .expense-delete { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; min-width: auto; height: 36px; flex-shrink: 0; background: #FEF2F2; color: #DC2626; border: 2px solid #FCA5A5; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 600; font-family: inherit; }
  .expense-delete:hover { background: #FCA5A5; border-color: #DC2626; color: white; }
  .expense-total { display: flex; justify-content: space-between; padding-top: 16px; margin-top: 8px; border-top: 2px solid #E5E7EB; font-weight: 700; }
  .total-amount { color: var(--orange); }
  
  .stops-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .stop-item { display: flex; align-items: center; gap: 16px; padding: 16px; background: white; border: 1px solid #E5E7EB; border-radius: 10px; cursor: grab; }
  .stop-grip { color: #9CA3AF; font-size: 20px; cursor: grab; padding: 0 4px; user-select: none; }
  .stop-number { width: 32px; height: 32px; background: var(--orange); color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
  
  /* FIX: Stop Input Container - take remaining space but shrink if needed */
  .stop-info { flex: 1; min-width: 0; margin-right: 24px; }
  
  /* FIX: Input takes 100% of parent (.stop-info) */
  .stop-address-input { width: 100%; padding: 10px 12px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-weight: 500; font-family: inherit; color: #111827; background: white; transition: border-color 0.2s; }
  .stop-address-input:focus { outline: none; border-color: var(--orange); }
  
  .stop-earnings-input { position: relative; width: 120px; flex-shrink: 0; }
  .stop-earnings-input .currency { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--green); font-weight: 700; font-size: 16px; }
  .stop-earnings-input input { width: 100%; padding: 10px 12px 10px 28px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 16px; font-weight: 700; font-family: inherit; color: var(--green); background: white; transition: border-color 0.2s; }
  .stop-earnings-input input:focus { outline: none; border-color: var(--green); }
  
  .stop-delete { width: 32px; height: 32px; background: #FEF2F2; color: #DC2626; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .stop-delete:hover { background: #FEE2E2; }
  
  .add-stop { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; }
  .add-stop input { padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; }
  .btn-add { display: flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--blue); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
  .btn-add:hover { background: #1E9BCF; }
  
  .cost-summary { padding: 16px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px; margin-bottom: 24px; }
  .cost-item { display: flex; justify-content: space-between; font-size: 14px; }
  .cost-value { font-weight: 700; color: var(--green); }
  
  .review-section { margin-bottom: 32px; }
  .review-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; }
  .review-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .review-item { display: flex; flex-direction: column; gap: 4px; padding: 16px; background: #F9FAFB; border-radius: 10px; }
  .review-label { font-size: 13px; color: #6B7280; }
  .review-value { font-size: 16px; font-weight: 600; color: #111827; }
  
  .financial-summary { padding: 24px; background: #F9FAFB; border-radius: 12px; }
  .summary-row { display: flex; justify-content: space-between; padding: 12px 0; font-size: 15px; }
  .summary-row.total { font-size: 18px; font-weight: 700; padding-top: 16px; }
  .summary-divider { height: 1px; background: #E5E7EB; margin: 12px 0; }
  .amount { font-weight: 600; color: #111827; }
  .amount.positive { color: var(--green); }
  .amount.negative { color: #DC2626; }
  
  .form-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 32px; padding-top: 24px; border-top: 1px solid #E5E7EB; }
  .btn-primary { display: flex; align-items: center; gap: 8px; padding: 14px 28px; background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
  .btn-secondary { display: flex; align-items: center; gap: 8px; padding: 14px 28px; background: white; color: #6B7280; border: 2px solid #E5E7EB; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
  
  .map-container { height: 300px; background: #f0f0f0; margin: 20px 0; border-radius: 12px; overflow: hidden; }
  .map { width: 100%; height: 100%; }

  @media (max-width: 768px) {
    .progress-steps { overflow-x: auto; }
    .step-label { font-size: 11px; }
    .form-grid, .review-grid { grid-template-columns: 1fr; }
    .add-stop { grid-template-columns: 1fr; }
    .options-grid { flex-direction: column; }
  }
</style>