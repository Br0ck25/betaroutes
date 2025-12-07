// src/routes/dashboard/trips/edit/[id]/+page.svelte
<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';
  import type { Destination, MaintenanceCost, SupplyCost } from '$lib/types';
  import { calculateTripTotals } from '$lib/utils/calculations';

  // FIX: Receive key from layout data
  export let data; 
  const API_KEY = data.googleMapsApiKey;

  const settings = $userSettings;
  const tripId = $page.params.id;

  let loading = true;
  let step = 1;
  
  // Form State
  let date = '';
  let startTime = '';
  let endTime = '';
  let startAddress = '';
  let endAddress = '';
  let mpg = 25;
  let gasPrice = 3.50;
  let distanceUnit = settings.distanceUnit || 'mi';
  let timeFormat = settings.timeFormat || '12h';

  let destinations: Destination[] = [{ address: '', earnings: 0 }];
  
  // Items with IDs for proper Svelte keying
  let maintenanceItems: (MaintenanceCost & { id: string })[] = [];
  let supplyItems: (SupplyCost & { id: string })[] = [];
  
  let notes = '';

  // Calculation State
  let calculating = false;
  let calculated = false;
  let totalMileage = 0;
  let totalTime = '';
  let totalEarnings = 0;
  let fuelCost = 0;
  let maintenanceCost = 0;
  let suppliesCost = 0;
  let netProfit = 0;
  let profitPerHour = 0;
  let hoursWorked = 0;

  // Maps State
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  let mapElement: HTMLElement;
  let mapsLoaded = false;

  // Options
  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];
  
  // Temporary input state
  let newMaintenanceItem = '';
  let newSupplyItem = '';
  let showAddMaintenance = false;
  let showAddSupply = false;

  onMount(async () => {
    // 1. Load Options
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);

    // 2. Load Trip Data
    await loadTrip();

    // 3. Load Maps
    if (!window.google) {
      const script = document.createElement('script');
      // FIX: Use API_KEY variable
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`;
      script.async = true;
      script.onload = () => {
        initMaps();
      };
      document.head.appendChild(script);
    } else {
      initMaps();
    }
  });

  // ... (Keep existing loadTrip function) ...
  async function loadTrip() {
    let userId = $user?.token;
    if (!userId) userId = localStorage.getItem('offline_user_id') || '';

    if (!userId) {
        goto('/login');
        return;
    }

    const trip = await trips.get(tripId, userId);
    
    if (!trip) {
        alert('Trip not found');
        goto('/dashboard/trips');
        return;
    }

    // Populate State
    date = trip.date || '';
    startTime = trip.startTime || trip.startClock || ''; 
    endTime = trip.endTime || trip.endClock || '';
    startAddress = trip.startAddress || '';
    endAddress = trip.endAddress || '';
    mpg = trip.mpg || 25;
    gasPrice = trip.gasPrice || 3.50;
    notes = trip.notes || '';
    hoursWorked = trip.hoursWorked || 0;
    
    if (trip.stops && trip.stops.length > 0) {
        destinations = trip.stops.map((s: any) => ({
            address: s.address,
            earnings: s.earnings || 0
        }));
    } else if (trip.destinations) {
        destinations = trip.destinations;
    }

    // Assign IDs to existing items so we can remove them reliably
    maintenanceItems = (trip.maintenanceItems || []).map((i: any) => ({ ...i, id: i.id || crypto.randomUUID() }));
    supplyItems = (trip.supplyItems || []).map((i: any) => ({ ...i, id: i.id || crypto.randomUUID() }));
    
    totalMileage = trip.totalMileage || 0;
    
    loading = false;
    await tick();
    
    // Auto-calculate route if we have data
    if (mapsLoaded && startAddress) {
        calculateRoute();
    }
  }

  function initMaps() {
    mapsLoaded = true;
    try {
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer();
        if (mapElement) {
            map = new google.maps.Map(mapElement, {
                center: { lat: 37.7749, lng: -122.4194 },
                zoom: 12
            });
            directionsRenderer.setMap(map);
        }
    } catch (e) {
        console.error("Maps init error", e);
    }
  }

  // --- Autocomplete Actions (Fixed for stuck box) ---
  function initAutocomplete(node: HTMLInputElement) {
    let retryCount = 0;
    const maxRetries = 20;
    
    const trySetup = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setupAutocomplete(node);
        return true;
      }
      return false;
    };

    if (trySetup()) return {};
    
    const interval = setInterval(() => {
      retryCount++;
      if (trySetup() || retryCount >= maxRetries) {
        clearInterval(interval);
      }
    }, 200);

    return {
      destroy() {
        clearInterval(interval);
      }
    };
  }
  
  function setupAutocomplete(input: HTMLInputElement) {
    if (input.dataset.autocompleteSetup === 'true') return;
    input.dataset.autocompleteSetup = 'true';
    
    const autocomplete = new google.maps.places.Autocomplete(input, { types: ['geocode'] });
    (input as any).autocompleteInstance = autocomplete;

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (place.formatted_address) {
        input.value = place.formatted_address;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
          input.dispatchEvent(event);
          forceHidePac();
          setTimeout(calculateRoute, 150);
        }, 50);
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        forceHidePac();
      }, 200);
    });

    let typingTimeout: any;
    input.addEventListener('input', () => {
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        if (input.value.length > 0) {
          const pacContainers = document.querySelectorAll('.pac-container');
          pacContainers.forEach(container => { (container as HTMLElement).style.display = ''; });
        }
      }, 100);
    });
  }

  function forceHidePac() {
    const containers = document.querySelectorAll('.pac-container');
    containers.forEach((c) => (c as HTMLElement).style.display = 'none');
  }

  // --- Helper Functions ---
  function convertDistance(miles: number) {
    return distanceUnit === 'km' ? miles * 1.60934 : miles;
  }

  function formatTime(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(`1970-01-01T${dateStr}:00`);
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h'
    });
  }

  // --- Logic ---
  async function addDestination() {
    destinations = [...destinations, { address: '', earnings: 0 }];
  }

  async function removeDestination(index: number) {
    if (destinations.length > 1) {
      destinations = destinations.filter((_, i) => i !== index);
    }
  }

  async function calculateRoute() {
    if (!mapsLoaded || !directionsService || !directionsRenderer) return;
    if (!startAddress) return;

    calculating = true;

    try {
      const waypoints = destinations
        .filter(d => d.address.trim() !== '')
        .map(d => ({
            location: d.address,
            stopover: true
        }));
      
      const destination = endAddress.trim() ? endAddress : startAddress;
      
      if (destination === startAddress && waypoints.length === 0) {
          calculating = false;
          return;
      }

      const request: google.maps.DirectionsRequest = {
        origin: startAddress,
        destination: destination,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING
      };

      const result = await directionsService.route(request);

      if (result.routes[0]) {
        directionsRenderer.setDirections(result);

        let distanceMeters = 0;
        let duration = 0;

        result.routes[0].legs.forEach(leg => {
          distanceMeters += leg.distance?.value || 0;
          duration += leg.duration?.value || 0;
        });

        const miles = convertDistance(distanceMeters / 1609.34);
        const minutes = duration / 60;

        const totals = calculateTripTotals(
          miles,
          minutes,
          destinations,
          mpg,
          gasPrice,
          maintenanceItems,
          supplyItems,
          formatTime(startTime),
          formatTime(endTime)
        );

        totalMileage = totals.totalMileage!;
        totalTime = totals.totalTime!;
        totalEarnings = totals.totalEarnings!;
        fuelCost = totals.fuelCost!;
        maintenanceCost = totals.maintenanceCost!;
        suppliesCost = totals.suppliesCost!;
        netProfit = totals.netProfit!;
        profitPerHour = totals.profitPerHour!;
        
        calculated = true;
      }
    } catch (error) {
      console.error('Route error:', error);
    } finally {
      calculating = false;
    }
  }

  async function updateTrip() {
    if (!calculated) {
        await calculateRoute();
    }

    let userId = $user?.token;
    if (!userId) userId = localStorage.getItem('offline_user_id') || '';

    const tripToSave = {
      id: tripId,
      date,
      startTime,
      endTime,
      startAddress,
      endAddress: endAddress || '',
      destinations: destinations, 
      stops: destinations.map((d, i) => ({
          id: crypto.randomUUID(),
          address: d.address,
          earnings: d.earnings,
          order: i
      })),
      totalMileage,
      totalTime,
      totalEarnings,
      fuelCost,
      maintenanceCost,
      maintenanceItems,
      suppliesCost,
      supplyItems,
      hoursWorked,
      netProfit,
      profitPerHour,
      mpg,
      gasPrice,
      notes,
      lastModified: new Date().toISOString()
    };

    try {
      await trips.updateTrip(tripId, tripToSave, userId);
      alert('Trip updated successfully!');
      goto('/dashboard/trips');
    } catch (err) {
      console.error('Update failed:', err);
      alert('Failed to update trip.');
    }
  }

  // --- Expenses Logic (Fixed IDs and Removal) ---
  function addMaintenanceItem(type: string) {
    maintenanceItems = [...maintenanceItems, { type, cost: 0, id: crypto.randomUUID() }];
  }
  function removeMaintenanceItem(id: string) {
    maintenanceItems = maintenanceItems.filter((i) => i.id !== id);
  }
  function addCustomMaintenance() {
    if (!newMaintenanceItem) return;
    addMaintenanceItem(newMaintenanceItem);
    newMaintenanceItem = '';
    showAddMaintenance = false;
  }
  
  function addSupplyItem(type: string) {
    supplyItems = [...supplyItems, { type, cost: 0, id: crypto.randomUUID() }];
  }
  function removeSupplyItem(id: string) {
    supplyItems = supplyItems.filter((i) => i.id !== id);
  }
  function addCustomSupply() {
    if (!newSupplyItem) return;
    addSupplyItem(newSupplyItem);
    newSupplyItem = '';
    showAddSupply = false;
  }

  // --- Reactivity ---
  $: {
    if (startTime && endTime) {
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        let diffMinutes = endMinutes - startMinutes;
        if (diffMinutes < 0) diffMinutes += 24 * 60; 
        hoursWorked = Math.round((diffMinutes / 60) * 10) / 10;
    }

    if (mpg && gasPrice && totalMileage) {
        const gallons = totalMileage / mpg;
        fuelCost = parseFloat((gallons * gasPrice).toFixed(2));
    }
    
    maintenanceCost = maintenanceItems.reduce((acc, item) => acc + (item.cost || 0), 0);
    suppliesCost = supplyItems.reduce((acc, item) => acc + (item.cost || 0), 0);
    totalEarnings = destinations.reduce((acc, d) => acc + (d.earnings || 0), 0);
    
    const costs = fuelCost + maintenanceCost + suppliesCost;
    netProfit = totalEarnings - costs;
    
    if (hoursWorked > 0) {
        profitPerHour = netProfit / hoursWorked;
    }
  }

  function nextStep() { if (step < 4) step++; }
  function prevStep() { if (step > 1) step--; }
</script>

<svelte:head>
  <title>Edit Trip - Go Route Yourself</title>
  <style>
    .pac-container { z-index: 10000 !important; background: white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border-radius: 8px; margin-top: 2px; font-family: inherit; }
  </style>
</svelte:head>

<div class="trip-form">
  <div class="page-header">
    <div>
      <h1 class="page-title">Edit Trip</h1>
      <p class="page-subtitle">Update trip details and earnings</p>
    </div>
    <a href="/dashboard/trips" class="btn-back">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Back
    </a>
  </div>

  {#if loading}
    <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading trip details...</p>
    </div>
  {:else}
    <div class="progress-steps">
        <div class="step-item" class:active={step >= 1} class:completed={step > 1} on:click={() => step = 1}>
        <div class="step-circle">{step > 1 ? '✓' : '1'}</div>
        <div class="step-label">Basic Info</div>
        </div>
        <div class="step-line" class:completed={step > 1}></div>
        <div class="step-item" class:active={step >= 2} class:completed={step > 2} on:click={() => step = 2}>
        <div class="step-circle">{step > 2 ? '✓' : '2'}</div>
        <div class="step-label">Route & Stops</div>
        </div>
        <div class="step-line" class:completed={step > 2}></div>
        <div class="step-item" class:active={step >= 3} class:completed={step > 3} on:click={() => step = 3}>
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
                <label>Date</label>
                <input type="date" bind:value={date} required />
            </div>
            <div class="form-group">
                <label>Start Time</label>
                <input type="time" bind:value={startTime} />
            </div>
            <div class="form-group">
                <label>End Time</label>
                <input type="time" bind:value={endTime} />
            </div>
            <div class="form-group">
                <label>Hours Worked</label>
                <div class="hours-display-field">{hoursWorked.toFixed(1)} hours</div>
            </div>
            </div>
            <div class="form-actions">
            <button class="btn-primary" type="button" on:click={nextStep}>Continue</button>
            </div>
        </div>
        {/if}

        {#if step === 2}
        <div class="form-card">
            <div class="card-header">
            <h2 class="card-title">Route & Stops</h2>
            </div>
            
            <div class="form-group">
            <label>Starting Address</label>
            <input type="text" bind:value={startAddress} placeholder="Start address" use:initAutocomplete />
            </div>
            
            <div class="stops-section">
            <div class="section-header"><h3>Destinations</h3></div>
            {#each destinations as dest, i}
                <div class="stop-item">
                <div class="stop-number">{i + 1}</div>
                <div class="stop-info">
                    <input type="text" class="stop-address-input" bind:value={dest.address} placeholder="Destination address" use:initAutocomplete />
                </div>
                <div class="stop-earnings-input">
                    <span class="currency">$</span>
                    <input type="number" bind:value={dest.earnings} placeholder="0" step="0.01" />
                </div>
                <button class="stop-delete" type="button" on:click={() => removeDestination(i)}>✕</button>
                </div>
            {/each}
            <div class="add-stop">
                <button class="btn-add" type="button" on:click={addDestination}>+ Add Stop</button>
            </div>
            </div>

            <div class="form-group">
            <label>End Address (Optional - defaults to Start if empty)</label>
            <input type="text" bind:value={endAddress} placeholder="End address (leave blank for round trip)" use:initAutocomplete />
            </div>

            <div class="form-group">
            <label>Total Miles (Auto-calculated)</label>
            <input type="number" bind:value={totalMileage} step="0.1" />
            </div>

            <div class="actions">
                <button class="btn-secondary" type="button" on:click={calculateRoute} disabled={calculating}>
                    {calculating ? 'Calculating...' : 'Recalculate Route'}
                </button>
            </div>

            <div class="map-container" class:hidden={!mapsLoaded}>
                <div bind:this={mapElement} class="map"></div>
            </div>

            <div class="form-actions">
            <button class="btn-secondary" type="button" on:click={prevStep}>Back</button>
            <button class="btn-primary" type="button" on:click={nextStep}>Continue</button>
            </div>
        </div>
        {/if}

        {#if step === 3}
        <div class="form-card">
            <div class="card-header">
            <h2 class="card-title">Costs & Expenses</h2>
            </div>
            <div class="form-grid">
            <div class="form-group">
                <label>Vehicle MPG</label>
                <input type="number" bind:value={mpg} step="0.1" />
            </div>
            <div class="form-group">
                <label>Gas Price</label>
                <div class="input-prefix">
                <span>$</span>
                <input type="number" bind:value={gasPrice} step="0.01" />
                </div>
            </div>
            </div>

            <div class="cost-summary">
            <div class="cost-item">
                <span>Fuel Cost (Calculated)</span>
                <span class="cost-value">${fuelCost.toFixed(2)}</span>
            </div>
            </div>

            <div class="expenses-section">
            <div class="section-header">
                <h3>Maintenance</h3>
                <button class="btn-add-custom" type="button" on:click={() => showAddMaintenance = !showAddMaintenance}>Add Custom</button>
            </div>
            {#if showAddMaintenance}
                <div class="custom-input-row">
                <input type="text" bind:value={newMaintenanceItem} placeholder="Item name" />
                <button class="btn-save" type="button" on:click={addCustomMaintenance}>Add</button>
                </div>
            {/if}
            <div class="options-grid">
                {#each maintenanceOptions as option}
                <button class="badge-btn" type="button" on:click={() => addMaintenanceItem(option)}>{option}</button>
                {/each}
            </div>
            {#each maintenanceItems as item (item.id)}
                <div class="expense-item">
                <span class="expense-type">{item.type}</span>
                <div class="expense-input">
                    <span class="currency">$</span>
                    <input type="number" bind:value={item.cost} />
                </div>
                <button class="expense-delete" type="button" on:click={() => removeMaintenanceItem(item.id)}>Remove</button>
                </div>
            {/each}
            </div>

            <div class="expenses-section">
            <div class="section-header">
                <h3>Supplies</h3>
                <button class="btn-add-custom" type="button" on:click={() => showAddSupply = !showAddSupply}>Add Custom</button>
            </div>
            {#if showAddSupply}
                <div class="custom-input-row">
                <input type="text" bind:value={newSupplyItem} placeholder="Item name" />
                <button class="btn-save" type="button" on:click={addCustomSupply}>Add</button>
                </div>
            {/if}
            <div class="options-grid">
                {#each suppliesOptions as option}
                <button class="badge-btn" type="button" on:click={() => addSupplyItem(option)}>{option}</button>
                {/each}
            </div>
            {#each supplyItems as item (item.id)}
                <div class="expense-item">
                <span class="expense-type">{item.type}</span>
                <div class="expense-input">
                    <span class="currency">$</span>
                    <input type="number" bind:value={item.cost} />
                </div>
                <button class="expense-delete" type="button" on:click={() => removeSupplyItem(item.id)}>Remove</button>
                </div>
            {/each}
            </div>

            <div class="form-group">
                <label>Notes</label>
                <textarea bind:value={notes} rows="3"></textarea>
            </div>

            <div class="form-actions">
            <button class="btn-secondary" type="button" on:click={prevStep}>Back</button>
            <button class="btn-primary" type="button" on:click={nextStep}>Continue</button>
            </div>
        </div>
        {/if}

        {#if step === 4}
        <div class="form-card">
            <div class="card-header">
            <h2 class="card-title">Review & Update</h2>
            </div>
            
            <div class="review-section">
            <div class="review-grid">
                <div class="review-item"><span class="review-label">Date</span> <span class="review-value">{date}</span></div>
                <div class="review-item"><span class="review-label">Time</span> <span class="review-value">{startTime} - {endTime}</span></div>
                <div class="review-item"><span class="review-label">Miles</span> <span class="review-value">{totalMileage}</span></div>
                <div class="review-item"><span class="review-label">Earnings</span> <span class="review-value">${totalEarnings.toFixed(2)}</span></div>
            </div>
            </div>

            <div class="financial-summary">
            <div class="summary-row"><span>Total Revenue</span> <span class="amount positive">${totalEarnings.toFixed(2)}</span></div>
            <div class="summary-row"><span>Total Costs</span> <span class="amount negative">${(fuelCost + maintenanceCost + suppliesCost).toFixed(2)}</span></div>
            <div class="summary-divider"></div>
            <div class="summary-row total"><span>Net Profit</span> <span class="amount" class:positive={netProfit >= 0} class:negative={netProfit < 0}>${netProfit.toFixed(2)}</span></div>
            </div>

            <div class="form-actions">
            <button class="btn-secondary" type="button" on:click={prevStep}>Back</button>
            <button class="btn-primary" type="button" on:click={updateTrip}>Update Trip</button>
            </div>
        </div>
        {/if}
    </div>
  {/if}
</div>

<style>
  /* Base Layout */
  .trip-form { max-width: 900px; margin: 0 auto; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  
  /* Loading */
  .loading-state { text-align: center; padding: 60px; color: #666; font-size: 1.1rem; }
  .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #FF7F50; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

  /* Buttons */
  .btn-back, .btn-secondary { background: white; color: #6B7280; border: 2px solid #E5E7EB; border-radius: 10px; padding: 10px 20px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; text-decoration: none; }
  .btn-back:hover, .btn-secondary:hover { border-color: var(--orange); color: var(--orange); }
  .btn-primary { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; border: none; border-radius: 10px; padding: 14px 28px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(255, 127, 80, 0.3); }
  .btn-add { background: var(--blue); color: white; border: none; padding: 12px 20px; border-radius: 10px; cursor: pointer; font-weight: 600; }
  .btn-add:hover { background: #1E9BCF; }
  
  /* Progress Steps */
  .progress-steps { display: flex; align-items: center; margin-bottom: 40px; padding: 24px; background: white; border: 1px solid #E5E7EB; border-radius: 16px; }
  .step-item { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; cursor: pointer; }
  .step-circle { width: 48px; height: 48px; border-radius: 50%; background: #F3F4F6; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; transition: all 0.3s; }
  .step-item.active .step-circle { background: linear-gradient(135deg, var(--orange) 0%, #FF6A3D 100%); color: white; box-shadow: 0 4px 12px rgba(255, 127, 80, 0.3); }
  .step-item.completed .step-circle { background: var(--green); color: white; }
  .step-label { font-size: 13px; font-weight: 600; color: #9CA3AF; text-align: center; }
  .step-item.active .step-label { color: #111827; }
  .step-line { flex: 1; height: 2px; background: #E5E7EB; margin: 0 16px; transition: all 0.3s; }
  .step-line.completed { background: var(--green); }
  
  /* Cards & Forms */
  .form-card { background: white; border: 1px solid #E5E7EB; border-radius: 16px; padding: 32px; }
  .card-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #E5E7EB; }
  .card-title { font-size: 24px; font-weight: 700; color: #111827; }
  
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 24px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .form-group label { font-size: 14px; font-weight: 600; color: #374151; }
  input, textarea { padding: 14px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; width: 100%; transition: all 0.2s; font-family: inherit; }
  input:focus, textarea:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  .input-prefix { position: relative; }
  .input-prefix span { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; }
  .hours-display-field { padding: 14px 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-weight: 600; color: #059669; }

  /* Map */
  .map-container { margin: 20px 0; border-radius: 12px; overflow: hidden; border: 1px solid #E5E7EB; height: 400px; }
  .map-container.hidden { display: none; }
  .map { width: 100%; height: 100%; }

  /* Stops & Expenses */
  .stops-section, .expenses-section { margin: 32px 0; padding: 24px; background: #F9FAFB; border-radius: 12px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .section-header h3 { font-size: 16px; font-weight: 700; color: #111827; margin: 0; }
  
  .stop-item, .expense-item { display: flex; align-items: center; gap: 16px; padding: 16px; background: white; border: 1px solid #E5E7EB; border-radius: 10px; margin-bottom: 12px; }
  .stop-number { width: 32px; height: 32px; background: var(--orange); color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
  .stop-info, .expense-type { flex: 1; font-weight: 600; color: #374151; font-size: 14px; }
  .stop-earnings-input, .expense-input { position: relative; width: 120px; flex-shrink: 0; }
  .stop-earnings-input .currency, .expense-input .currency { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--green); font-weight: 700; }
  .stop-earnings-input input, .expense-input input { padding-left: 28px; color: var(--green); font-weight: 700; }
  .stop-delete, .expense-delete { width: 32px; height: 32px; background: #FEF2F2; color: #DC2626; border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .stop-delete:hover, .expense-delete:hover { background: #FCA5A5; color: white; }

  /* FIXED: Expense Delete Button (Text Mode - Same as New Trip) */
  .expense-delete { 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    gap: 6px; 
    padding: 8px 16px; 
    min-width: auto; 
    height: 36px; 
    flex-shrink: 0; 
    background: #FEF2F2; 
    color: #DC2626; 
    border: 2px solid #FCA5A5; 
    border-radius: 8px; 
    cursor: pointer; 
    transition: all 0.2s; 
    font-size: 14px; 
    font-weight: 600; 
    font-family: inherit;
  }
  .expense-delete:hover { background: #FCA5A5; border-color: #DC2626; color: white; }

  .add-stop { display: flex; justify-content: flex-end; }

  /* Options Badges */
  .options-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .badge-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: white; color: #374151; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .badge-btn:hover { border-color: var(--orange); color: var(--orange); }
  .btn-add-custom { padding: 6px 12px; font-size: 13px; font-weight: 600; color: var(--blue); background: white; border: 2px solid var(--blue); border-radius: 8px; cursor: pointer; }
  .btn-add-custom:hover { background: var(--blue); color: white; }
  .custom-input-row { display: flex; gap: 8px; margin-bottom: 16px; }
  .btn-save { padding: 10px 16px; background: var(--green); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }

  /* Summary */
  .cost-summary, .financial-summary { padding: 16px; background: #F9FAFB; border-radius: 12px; margin-bottom: 24px; }
  .cost-item, .summary-row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 0; }
  .cost-value, .amount { font-weight: 700; }
  .cost-value { color: var(--green); }
  .summary-row.total { border-top: 1px solid #E5E7EB; margin-top: 8px; padding-top: 12px; font-size: 18px; }
  .amount.positive { color: var(--green); }
  .amount.negative { color: #DC2626; }
  .review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .review-item { background: #F9FAFB; padding: 16px; border-radius: 10px; }
  .review-label { display: block; font-size: 12px; color: #6B7280; margin-bottom: 4px; }
  .review-value { font-weight: 700; color: #111827; }

  /* Form Actions */
  .form-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 32px; padding-top: 24px; border-top: 1px solid #E5E7EB; }

  @media (max-width: 768px) {
    .progress-steps { overflow-x: auto; }
    .form-grid, .review-grid { grid-template-columns: 1fr; }
  }
</style>