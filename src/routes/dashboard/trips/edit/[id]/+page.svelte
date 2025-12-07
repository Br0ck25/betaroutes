<script lang="ts">
  import { trips } from '$lib/stores/trips';
  import { userSettings } from '$lib/stores/userSettings';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth';
  import { page } from '$app/stores';

  // FIX: Receive key from layout data
  export let data;
  $: API_KEY = data.googleMapsApiKey;

  const tripId = $page.params.id;

  let step = 1;
  let loading = true;
  let saving = false;

  let mapLoaded = false;
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  let mapElement: HTMLElement; // Reference for the map div

  let maintenanceOptions = ['Oil Change', 'Tire Rotation', 'Brake Service', 'Filter Replacement'];
  let suppliesOptions = ['Concrete', 'Poles', 'Wire', 'Tools', 'Equipment Rental'];

  // Initial empty state
  let tripData = {
    id: tripId,
    date: new Date().toISOString().split('T')[0],
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

  onMount(async () => {
    // 1. Load Custom Options
    const savedMaintenance = localStorage.getItem('maintenanceOptions');
    const savedSupplies = localStorage.getItem('suppliesOptions');
    if (savedMaintenance) maintenanceOptions = JSON.parse(savedMaintenance);
    if (savedSupplies) suppliesOptions = JSON.parse(savedSupplies);

    // 2. Load Trip Data
    await loadTripData();

    // 3. Load Maps
    if (!API_KEY) {
        console.error('❌ Google Maps API Key is missing.');
    } else if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`;
      script.async = true;
      script.onload = () => {
        mapLoaded = true;
        initMapServices();
      };
      document.head.appendChild(script);
    } else {
      mapLoaded = true;
      initMapServices();
    }
  });

  function initMapServices() {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    
    // If we have addresses loaded, calculate route to show map immediately
    if (tripData.startAddress) {
        // Small delay to ensure DOM is ready if we are on step 2
        setTimeout(calculateRoute, 500);
    }
  }

  async function loadTripData() {
    // Ensure we have a user ID to query
    let userId = $user?.name || $user?.token || localStorage.getItem('offline_user_id');
    
    // If trips store is empty, try to load it first
    if (!$trips || $trips.length === 0) {
        if (userId) await trips.load(userId);
    }

    const found = $trips.find(t => t.id === tripId);
    
    if (!found) {
        alert('Trip not found');
        goto('/dashboard/trips');
        return;
    }

    // Populate Data
    tripData = {
        ...JSON.parse(JSON.stringify(found)),
        // Ensure arrays and numbers are safe
        stops: found.stops || [],
        maintenanceItems: found.maintenanceItems || [],
        suppliesItems: found.suppliesItems || [],
        totalMiles: Number(found.totalMiles) || 0,
        hoursWorked: Number(found.hoursWorked) || 0,
        fuelCost: Number(found.fuelCost) || 0,
        mpg: Number(found.mpg) || 25,
        gasPrice: Number(found.gasPrice) || 3.50
    };

    loading = false;
  }

  function addStop() {
    if (!newStop.address) return;
    tripData.stops = [...tripData.stops, { ...newStop, id: crypto.randomUUID() }];
    newStop = { address: '', earnings: 0, notes: '' };
    calculateRoute();
  }
  
  function removeStop(id: string) {
    tripData.stops = tripData.stops.filter(s => s.id !== id);
    calculateRoute();
  }
  
  function addMaintenanceItem(type: string) {
    tripData.maintenanceItems = [...tripData.maintenanceItems, {
      id: crypto.randomUUID(),
      type,
      cost: 0
    }];
  }
  
  function removeMaintenanceItem(id: string) {
    tripData.maintenanceItems = tripData.maintenanceItems.filter(m => m.id !== id);
  }
  
  function addCustomMaintenance() {
    if (!newMaintenanceItem.trim()) return;
    maintenanceOptions = [...maintenanceOptions, newMaintenanceItem.trim()];
    localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions));
    addMaintenanceItem(newMaintenanceItem.trim());
    newMaintenanceItem = '';
    showAddMaintenance = false;
  }
  
  function deleteMaintenanceOption(option: string) {
    if (confirm(`Delete "${option}" from maintenance options?`)) {
      maintenanceOptions = maintenanceOptions.filter(o => o !== option);
      localStorage.setItem('maintenanceOptions', JSON.stringify(maintenanceOptions));
    }
  }
  
  function addSupplyItem(type: string) {
    tripData.suppliesItems = [...tripData.suppliesItems, {
      id: crypto.randomUUID(),
      type,
      cost: 0
    }];
  }
  
  function removeSupplyItem(id: string) {
    tripData.suppliesItems = tripData.suppliesItems.filter(s => s.id !== id);
  }
  
  function addCustomSupply() {
    if (!newSupplyItem.trim()) return;
    suppliesOptions = [...suppliesOptions, newSupplyItem.trim()];
    localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions));
    addSupplyItem(newSupplyItem.trim());
    newSupplyItem = '';
    showAddSupply = false;
  }
  
  function deleteSupplyOption(option: string) {
    if (confirm(`Delete "${option}" from supplies options?`)) {
      suppliesOptions = suppliesOptions.filter(o => o !== option);
      localStorage.setItem('suppliesOptions', JSON.stringify(suppliesOptions));
    }
  }
  
  function calculateRoute() {
    if (!mapLoaded || !directionsService) return;
    if (!tripData.startAddress) return;
    
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
      travelMode: google.maps.TravelMode.DRIVING
    }, (result: any, status: any) => {
      if (status === 'OK') {
         // Initialize Map if not already done (and we are on correct step/view)
        if (mapElement && !map) {
             map = new google.maps.Map(mapElement, {
                center: { lat: 37.7749, lng: -122.4194 },
                zoom: 12
            });
            directionsRenderer?.setMap(map);
        }

        directionsRenderer?.setDirections(result);
        const route = result.routes[0];
        let totalMeters = 0;
        route.legs.forEach((leg: any) => {
          totalMeters += leg.distance.value;
        });
        
        // Only auto-update miles if we are actively editing the route step
        if (step === 2) {
             tripData.totalMiles = Math.round((totalMeters / 1609.34) * 10) / 10;
        }
      }
    });
  }
  
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
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
      let diffMinutes = endMinutes - startMinutes;
      if (diffMinutes < 0) {
        diffMinutes += 24 * 60;
      }
      tripData.hoursWorked = Math.round((diffMinutes / 60) * 10) / 10;
    }
  }
  
  function nextStep() { 
      if (step < 4) {
          step++;
           // Trigger map resize/init if moving to route step
          if (step === 2) {
              setTimeout(calculateRoute, 100);
          }
      } 
  }
  function prevStep() { if (step > 1) step--; }
  
  async function updateTrip() {
    saving = true;
    let userId = $page.data.user?.token || $user?.token; // Try token first as standard ID
    
    // Fallback logic
    if (!userId) {
        userId = $user?.name;
    }
    if (!userId) {
        userId = localStorage.getItem('offline_user_id');
    }
    
    if (!userId) {
        alert("Authentication error: User ID missing.");
        saving = false;
        return;
    }
    
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
      updatedAt: new Date().toISOString()
    };

    try {
      await trips.updateTrip(tripId, tripToSave, userId);
      alert('Trip updated successfully!');
      goto('/dashboard/trips');
    } catch (err) {
      console.error('Failed to update trip:', err);
      alert('Failed to update trip. Please try again.');
    } finally {
        saving = false;
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
    let retryCount = 0;
    const maxRetries = 10;
    const trySetup = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setupAutocomplete(node);
        return true;
      }
      return false;
    };
    if (trySetup()) return {};
    const retryInterval = setInterval(() => {
      retryCount++;
      if (trySetup() || retryCount >= maxRetries) clearInterval(retryInterval);
    }, 200);
    return { destroy() { clearInterval(retryInterval); } };
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
          const event = new KeyboardEvent('keydown', { key: 'Escape', 
            code: 'Escape', keyCode: 27, which: 27, bubbles: true });
          input.dispatchEvent(event);
          forceHidePac();
          
          // Force update reactivity if bound var didn't catch it
          if (input.id === 'start-address') tripData.startAddress = input.value;
          if (input.id === 'end-address') tripData.endAddress = input.value;
          
          setTimeout(calculateRoute, 150);
        }, 50);
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        forceHidePac();
      }, 200);
    });
  }

  function forceHidePac() {
    const containers = document.querySelectorAll('.pac-container');
    containers.forEach((c) => (c as HTMLElement).style.display = 'none');
  }
</script>

<svelte:head>
  <title>Edit Trip - Go Route Yourself</title>
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
      <p class="page-subtitle">Update trip details and costs</p>
    </div>
    <a href="/dashboard/trips" class="btn-back">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M12 4L6 10L12 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Back
    </a>
  </div>
  
  {#if loading}
     <div class="loading-state">Loading trip data...</div>
  {:else}
      <div class="progress-steps">
        <div class="step-item" class:active={step >= 1} class:completed={step > 1}>
          <div class="step-circle">{step > 1 ? '✓' : '1'}</div>
          <div class="step-label">Basic Info</div>
        </div>
        <div class="step-line" class:completed={step > 1}></div>
        <div class="step-item" class:active={step >= 2} class:completed={step > 2}>
          <div class="step-circle">{step > 2 ? '✓' : '2'}</div>
          <div class="step-label">Route & Stops</div>
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
                <small class="field-hint">Auto-calculated</small>
              </div>
            </div>
            <div class="form-actions">
              <button class="btn-primary" on:click={nextStep}>Continue</button>
            </div>
          </div>
        {/if}
        
        {#if step === 2}
          <div class="form-card">
            <div class="card-header">
              <h2 class="card-title">Route & Stops</h2>
              <p class="card-subtitle">Add your starting point and destinations</p>
            </div>
            <div class="form-group">
              <label>Starting Address</label>
              <input type="text" id="start-address" bind:value={tripData.startAddress} use:initAutocomplete placeholder="Start address" />
            </div>
            <div class="form-group">
              <label>End Address</label>
              <input type="text" id="end-address" bind:value={tripData.endAddress} use:initAutocomplete placeholder="End address" />
            </div>
            
            <div class="stops-section">
              <div class="section-header"><h3>Stops & Earnings</h3></div>
              {#if tripData.stops.length > 0}
                <div class="stops-list">
                  {#each tripData.stops as stop, i}
                    <div class="stop-item">
                      <div class="stop-number">{i + 1}</div>
                      <div class="stop-info">
                        <input type="text" class="stop-address-input" bind:value={stop.address} placeholder="Stop address" use:initAutocomplete />
                      </div>
                      <div class="stop-earnings-input">
                        <span class="currency">$</span>
                        <input type="number" bind:value={stop.earnings} placeholder="0" step="0.01" min="0" />
                      </div>
                      <button class="stop-delete" on:click={() => removeStop(stop.id)}>×</button>
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="add-stop">
                <input type="text" placeholder="Stop address" bind:value={newStop.address} use:initAutocomplete />
                <input type="number" placeholder="Earnings ($)" bind:value={newStop.earnings} step="0.01" min="0" />
                <button class="btn-add" on:click={addStop}>Add Stop</button>
              </div>
            </div>
            
            <div class="map-container">
                 <div bind:this={mapElement} class="map"></div>
            </div>

            <div class="form-group">
              <label>Total Miles <span class="label-hint">(Editable)</span></label>
              <input type="number" bind:value={tripData.totalMiles} placeholder="0.0" step="0.1" min="0" />
            </div>
            
            <div class="form-actions">
              <button class="btn-secondary" on:click={prevStep}>Back</button>
              <button class="btn-primary" on:click={nextStep}>Continue</button>
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
              <div class="form-group"><label>Vehicle MPG</label><input type="number" bind:value={tripData.mpg} step="0.1" min="0" /></div>
              <div class="form-group"><label>Gas Price</label><div class="input-prefix"><span>$</span><input type="number" bind:value={tripData.gasPrice} step="0.01" min="0" /></div></div>
            </div>
            
            <div class="cost-summary">
              <div class="cost-item"><span>Fuel Cost (calculated)</span><span class="cost-value">{formatCurrency(tripData.fuelCost)}</span></div>
            </div>
            
            <div class="expenses-section">
              <div class="section-header">
                <h3>Maintenance Costs</h3>
                <div class="header-actions"><button class="btn-add-custom" on:click={() => showAddMaintenance = !showAddMaintenance}>Add Custom</button></div>
              </div>
              {#if showAddMaintenance}
                <div class="custom-input-row">
                  <input type="text" bind:value={newMaintenanceItem} placeholder="Enter custom item..." />
                  <button class="btn-save" on:click={addCustomMaintenance}>Save</button>
                  <button class="btn-cancel" on:click={() => showAddMaintenance = false}>Cancel</button>
                </div>
              {/if}
              <div class="options-grid">
                {#each maintenanceOptions as option}
                  <div class="option-badge">
                    <button class="badge-btn" on:click={() => addMaintenanceItem(option)}>{option}</button>
                    <button class="badge-delete" on:click={() => deleteMaintenanceOption(option)}>×</button>
                  </div>
                {/each}
              </div>
              {#if tripData.maintenanceItems.length > 0}
                <div class="expense-items">
                  {#each tripData.maintenanceItems as item}
                    <div class="expense-item">
                      <span class="expense-type">{item.type}</span>
                      <div class="expense-input"><span class="currency">$</span><input type="number" bind:value={item.cost} step="0.01" min="0" /></div>
                      <button class="expense-delete" on:click={() => removeMaintenanceItem(item.id)}>Remove</button>
                    </div>
                  {/each}
                  <div class="expense-total"><span>Total Maintenance</span><span class="total-amount">{formatCurrency(totalMaintenanceCost)}</span></div>
                </div>
              {/if}
            </div>
            
            <div class="expenses-section">
              <div class="section-header">
                <h3>Supplies Costs</h3>
                <div class="header-actions"><button class="btn-add-custom" on:click={() => showAddSupply = !showAddSupply}>Add Custom</button></div>
              </div>
              {#if showAddSupply}
                <div class="custom-input-row">
                  <input type="text" bind:value={newSupplyItem} placeholder="Enter custom item..." />
                  <button class="btn-save" on:click={addCustomSupply}>Save</button>
                  <button class="btn-cancel" on:click={() => showAddSupply = false}>Cancel</button>
                </div>
              {/if}
              <div class="options-grid">
                {#each suppliesOptions as option}
                  <div class="option-badge">
                    <button class="badge-btn" on:click={() => addSupplyItem(option)}>{option}</button>
                    <button class="badge-delete" on:click={() => deleteSupplyOption(option)}>×</button>
                  </div>
                {/each}
              </div>
              {#if tripData.suppliesItems.length > 0}
                <div class="expense-items">
                  {#each tripData.suppliesItems as item}
                    <div class="expense-item">
                      <span class="expense-type">{item.type}</span>
                      <div class="expense-input"><span class="currency">$</span><input type="number" bind:value={item.cost} step="0.01" min="0" /></div>
                      <button class="expense-delete" on:click={() => removeSupplyItem(item.id)}>Remove</button>
                    </div>
                  {/each}
                  <div class="expense-total"><span>Total Supplies</span><span class="total-amount">{formatCurrency(totalSuppliesCost)}</span></div>
                </div>
              {/if}
            </div>
            
            <div class="form-group">
              <label>Notes</label>
              <textarea bind:value={tripData.notes} rows="4"></textarea>
            </div>
            
            <div class="form-actions">
              <button class="btn-secondary" on:click={prevStep}>Back</button>
              <button class="btn-primary" on:click={nextStep}>Review</button>
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
                <div class="review-item"><span class="review-label">Date</span><span class="review-value">{formatDateLocal(tripData.date)}</span></div>
                <div class="review-item"><span class="review-label">Time</span><span class="review-value">{formatTime12Hour(tripData.startTime)} - {formatTime12Hour(tripData.endTime)}</span></div>
                <div class="review-item"><span class="review-label">Hours Worked</span><span class="review-value">{tripData.hoursWorked || 0} hours</span></div>
                <div class="review-item"><span class="review-label">Total Miles</span><span class="review-value">{tripData.totalMiles} mi</span></div>
                <div class="review-item"><span class="review-label">Number of Stops</span><span class="review-value">{tripData.stops.length}</span></div>
              </div>
            </div>
            
            <div class="review-section">
              <h3 class="review-title">Financial Summary</h3>
              <div class="financial-summary">
                <div class="summary-row"><span>Total Earnings</span><span class="amount positive">{formatCurrency(totalEarnings)}</span></div>
                <div class="summary-row"><span>Fuel Cost</span><span class="amount">{formatCurrency(tripData.fuelCost)}</span></div>
                <div class="summary-row"><span>Maintenance</span><span class="amount">{formatCurrency(totalMaintenanceCost)}</span></div>
                <div class="summary-row"><span>Supplies</span><span class="amount">{formatCurrency(totalSuppliesCost)}</span></div>
                <div class="summary-divider"></div>
                <div class="summary-row total">
                  <span>Net Profit</span>
                  <span class="amount" class:positive={totalProfit >= 0} class:negative={totalProfit < 0}>{formatCurrency(totalProfit)}</span>
                </div>
                {#if tripData.hoursWorked > 0}
                  <div class="summary-row hourly">
                    <span>Hourly Pay</span>
                    <span class="amount positive">{formatCurrency(totalProfit / tripData.hoursWorked)}/hr</span>
                  </div>
                {/if}
              </div>
            </div>
            
            <div class="form-actions">
              <button class="btn-secondary" on:click={prevStep}>Back</button>
              <button class="btn-primary" on:click={updateTrip} disabled={saving}>{saving ? 'Saving...' : 'Update Trip'}</button>
            </div>
          </div>
        {/if}
      </div>
  {/if}
</div>

<style>
  .trip-form { max-width: 900px; margin: 0 auto; padding-bottom: 40px; }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .page-title { font-size: 32px; font-weight: 800; color: #111827; margin-bottom: 4px; }
  .page-subtitle { font-size: 16px; color: #6B7280; }
  .btn-back { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: white; color: #6B7280; border: 2px solid #E5E7EB; border-radius: 10px; font-weight: 600; text-decoration: none; transition: all 0.2s; }
  .btn-back:hover { border-color: var(--orange); color: var(--orange); }
  
  .loading-state { text-align: center; padding: 60px; color: #6B7280; font-size: 16px; }

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
  .card-header { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid #E5E7EB; }
  .card-title { font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 8px; }
  .card-subtitle { font-size: 15px; color: #6B7280; }
  
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 24px; }
  .form-group { display: flex; flex-direction: column; gap: 8px; }
  .form-group label { font-size: 14px; font-weight: 600; color: #374151; }
  .label-hint { font-size: 12px; font-weight: 400; color: #9CA3AF; }
  .field-hint { display: block; margin-top: 6px; font-size: 12px; color: #6B7280; font-style: italic; }
  .hours-display-field { padding: 14px 16px; background: #F9FAFB; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-weight: 600; color: #059669; }
  
  .form-group input, .form-group textarea { padding: 14px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; background: white; transition: all 0.2s; }
  .form-group input:focus, .form-group textarea:focus { outline: none; border-color: var(--orange); box-shadow: 0 0 0 3px rgba(255, 127, 80, 0.1); }
  
  .input-prefix { position: relative; }
  .input-prefix span { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .input-prefix input { padding-left: 36px; }
  textarea { resize: vertical; min-height: 100px; }
  
  .stops-section, .expenses-section { margin: 32px 0; padding: 24px; background: #F9FAFB; border-radius: 12px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .section-header h3 { font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .header-actions { display: flex; gap: 8px; }
  
  .btn-add-custom { display: flex; align-items: center; gap: 6px; padding: 8px 14px; background: white; color: var(--blue); border: 2px solid var(--blue); border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family: inherit; }
  .btn-add-custom:hover { background: var(--blue); color: white; }
  
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
  .expense-type { flex: 1; font-size: 14px; font-weight: 600; color: #374151; }
  .expense-input { position: relative; width: 140px; }
  .expense-input .currency { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6B7280; font-weight: 600; }
  .expense-input input { width: 100%; padding: 8px 12px 8px 28px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-family: inherit; }
  .expense-delete { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; min-width: auto; height: 36px; flex-shrink: 0; background: #FEF2F2; color: #DC2626; border: 2px solid #FCA5A5; border-radius: 8px; cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 600; font-family: inherit; }
  .expense-delete:hover { background: #FCA5A5; border-color: #DC2626; color: white; }
  .expense-total { display: flex; justify-content: space-between; padding-top: 16px; margin-top: 8px; border-top: 2px solid #E5E7EB; font-weight: 700; }
  .total-amount { color: var(--orange); }
  
  .stops-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .stop-item { display: flex; align-items: center; gap: 16px; padding: 16px; background: white; border: 1px solid #E5E7EB; border-radius: 10px; }
  .stop-number { width: 32px; height: 32px; background: var(--orange); color: white; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
  .stop-info { flex: 1; min-width: 0; }
  .stop-address-input { width: 100%; padding: 10px 12px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 14px; font-weight: 500; font-family: inherit; color: #111827; background: white; transition: border-color 0.2s; }
  .stop-address-input:focus { outline: none; border-color: var(--orange); }
  .stop-earnings-input { position: relative; width: 120px; flex-shrink: 0; }
  .stop-earnings-input .currency { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--green); font-weight: 700; font-size: 16px; }
  .stop-earnings-input input { width: 100%; padding: 10px 12px 10px 28px; border: 2px solid #E5E7EB; border-radius: 8px; font-size: 16px; font-weight: 700; font-family: inherit; color: var(--green); background: white; transition: border-color 0.2s; }
  .stop-earnings-input input:focus { outline: none; border-color: var(--green); }
  .stop-delete { width: 32px; height: 32px; background: #FEF2F2; color: #DC2626; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
  .stop-delete:hover { background: #FEE2E2; }
  
  .add-stop { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; }
  .add-stop input { padding: 12px 16px; border: 2px solid #E5E7EB; border-radius: 10px; font-size: 15px; font-family: inherit; }
  .btn-add { display: flex; align-items: center; gap: 8px; padding: 12px 20px; background: var(--blue); color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
  .btn-add:hover { background: #1E9BCF; }
  
  .cost-summary { padding: 16px; background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px; margin-bottom: 24px; }
  .cost-item { display: flex; justify-content: space-between; font-size: 14px; }
  .cost-value { font-weight: 700; color: var(--green); }
  
  /* Map */
  .map-container { height: 300px; background: #f0f0f0; margin: 20px 0; border-radius: 12px; overflow: hidden; }
  .map { width: 100%; height: 100%; }

  /* Review Section */
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
  
  @media (max-width: 768px) {
    .progress-steps { overflow-x: auto; }
    .step-label { font-size: 11px; }
    .form-grid, .review-grid { grid-template-columns: 1fr; }
    .add-stop { grid-template-columns: 1fr; }
    .options-grid { flex-direction: column; }
  }
</style>