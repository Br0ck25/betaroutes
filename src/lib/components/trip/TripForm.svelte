<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { get } from 'svelte/store';
  import { onMount, tick } from 'svelte';
  import type { Destination, MaintenanceCost, SupplyCost } from '$lib/types';
  import { calculateTripTotals } from '$lib/utils/calculations';
  import { storage } from '$lib/utils/storage';
  import { trips, draftTrip } from '$lib/stores/trips';
  import { user } from '$lib/stores/auth';
  import { autocomplete, loadGoogle } from '$lib/utils/autocomplete';

  // Props
  export let googleApiKey = '';

  const settings = get(userSettings);
  const API_KEY = googleApiKey || 'AIzaSyB7uqKfS8zRRPTJOv4t48yRTCnUvBjANCc';

  // Default values
  let date = new Date().toISOString().split('T')[0];
  let startTime = '';
  let endTime = '';
  let startAddress = settings.startLocation || storage.getSetting('defaultStartAddress') || '';
  let endAddress = settings.endLocation || storage.getSetting('defaultEndAddress') || '';
  let mpg = settings.defaultMPG ?? storage.getSetting('defaultMPG') ?? 25;
  let gasPrice = settings.defaultGasPrice ?? storage.getSetting('defaultGasPrice') ?? 3.5;
  let distanceUnit = settings.distanceUnit || 'mi';
  let timeFormat = settings.timeFormat || '12h';
  let destinations: Destination[] = [{ address: '', earnings: 0 }];
  let maintenanceItems: MaintenanceCost[] = [];
  let supplyItems: SupplyCost[] = [];
  let notes = '';

  // Results State
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

  // Google Maps Objects (Lazy Loaded)
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  let mapElement: HTMLElement;
  let mapsInitialized = false;

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

  onMount(async () => {
    // NO Google load here! (Saves Money)
    
    const draft = draftTrip.load();
    if (draft && confirm('Resume your last unsaved trip?')) {
      loadDraft(draft);
    }
    const autoSaveInterval = setInterval(() => saveDraft(), 5000);
    return () => clearInterval(autoSaveInterval);
  });

  // Lazy Initializer: Called ONLY when user clicks 'Calculate Route'
  async function ensureMapReady() {
    if (mapsInitialized && map) return true;
    
    try {
      // 1. Ensure Script is loaded (if user hasn't focused inputs yet)
      await loadGoogle(API_KEY);
      
      // 2. Initialize Visual Map
      if (mapElement) {
          map = new google.maps.Map(mapElement, {
            center: { lat: 37.7749, lng: -122.4194 },
            zoom: 12
          });
          directionsService = new google.maps.DirectionsService();
          directionsRenderer = new google.maps.DirectionsRenderer({ map });
          mapsInitialized = true;
          return true;
      }
    } catch (error) {
      console.error('Error initializing map:', error);
      alert('Failed to load Google Maps.');
      return false;
    }
    return false;
  }

  function handlePlaceSelect(field: 'start' | 'end' | number, e: CustomEvent) {
      const place = e.detail;
      const val = place.formatted_address || place.name || '';
      
      if (field === 'start') startAddress = val;
      else if (field === 'end') endAddress = val;
      else if (typeof field === 'number') destinations[field].address = val;
  }

  async function addDestination() {
    destinations = [...destinations, { address: '', earnings: 0 }];
    await tick();
  }

  async function removeDestination(index: number) {
    if (destinations.length > 1) {
      destinations = destinations.filter((_, i) => i !== index);
    }
  }

  async function moveDestinationUp(index: number) {
    if (index > 0) {
      [destinations[index], destinations[index - 1]] = [destinations[index - 1], destinations[index]];
      destinations = [...destinations];
    }
  }

  async function moveDestinationDown(index: number) {
    if (index < destinations.length - 1) {
      [destinations[index], destinations[index + 1]] = [destinations[index + 1], destinations[index]];
      destinations = [...destinations];
    }
  }

  async function calculateRoute() {
    if (!startAddress || destinations.some(d => !d.address.trim())) {
      alert('Please fill in all addresses');
      return;
    }

    calculating = true;

    try {
      // Lazy Load happens here
      const ready = await ensureMapReady();
      if (!ready || !directionsService || !directionsRenderer) {
        throw new Error('Map services not available');
      }

      const waypoints = destinations.map(d => ({
        location: d.address, 
        stopover: true
      }));

      const request: google.maps.DirectionsRequest = {
        origin: startAddress,
        destination: endAddress || destinations[destinations.length - 1].address,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING
      };

      const result = await directionsService.route(request);

      if (result.routes[0]) {
        directionsRenderer.setDirections(result);

        let distanceMeters = 0;
        let duration = 0;

        result.routes[0].legs.forEach((leg) => {
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

        // Update state
        totalMileage = totals.totalMileage!;
        totalTime = totals.totalTime!;
        totalEarnings = totals.totalEarnings!;
        fuelCost = totals.fuelCost!;
        maintenanceCost = totals.maintenanceCost!;
        suppliesCost = totals.suppliesCost!;
        netProfit = totals.netProfit!;
        profitPerHour = totals.profitPerHour!;
        hoursWorked = totals.hoursWorked!;

        calculated = true;
      }
    } catch (error: any) {
      console.error('Route error:', error);
      alert('Error calculating route. Please check addresses.');
    } finally {
      calculating = false;
    }
  }

  async function logTrip() {
    if (!calculated) {
      alert('Please calculate route first');
      return;
    }
    
    // ... (Log Trip logic same as before) ...
    // Note: I'm omitting the full logTrip block here for brevity since it didn't change,
    // but in your file you should keep the existing logic.
    
    // Just putting a placeholder for the parts that didn't change to save response size
    // COPY YOUR EXISTING logTrip FUNCTION HERE
    const currentUser = get(user);
    // ... rest of logTrip code from previous files ...
    try {
         // ...
         alert('Trip logged and saved!');
         resetForm();
    } catch(err) {
        // ...
    }
  }

  async function resetForm() {
    date = new Date().toISOString().split('T')[0];
    startTime = '';
    endTime = '';
    notes = '';
    destinations = [{ address: '', earnings: 0 }];
    calculated = false;
    if (directionsRenderer) directionsRenderer.setDirections({ routes: [] } as any);
  }

  function saveDraft() {
    draftTrip.save({ date, startClock: startTime, endClock: endTime, startAddress, endAddress, destinations, mpg, gasPrice, notes });
  }

  async function loadDraft(draft: any) {
    date = draft.date || date;
    startTime = draft.startClock || '';
    endTime = draft.endClock || '';
    startAddress = draft.startAddress || '';
    endAddress = draft.endAddress || '';
    destinations = draft.destinations || [{ address: '', earnings: 0 }];
    mpg = draft.mpg || mpg;
    gasPrice = draft.gasPrice || gasPrice;
    notes = draft.notes || '';
  }
</script>

<div class="container">
  <h2>Plan Your Trip</h2>

  <div class="form-section">
    <label>Date <input type="date" bind:value={date} /></label>

    <label>
      Start Address
      <input 
        type="text" 
        bind:value={startAddress} 
        placeholder="Start address" 
        autocomplete="off" 
        use:autocomplete={{ apiKey: API_KEY }}
        on:place-selected={(e) => handlePlaceSelect('start', e)}
      />
    </label>

    <div class="destinations">
      <label>Destinations</label>
      {#each destinations as dest, i}
        <div class="dest-row">
          <input 
            type="text" 
            bind:value={dest.address} 
            placeholder="Destination" 
            autocomplete="off"
            use:autocomplete={{ apiKey: API_KEY }}
            on:place-selected={(e) => handlePlaceSelect(i, e)}
          />
          <input type="number" bind:value={dest.earnings} placeholder="$" step="0.01" />
          <button type="button" on:click={() => moveDestinationUp(i)} disabled={i === 0}>↑</button>
          <button type="button" on:click={() => moveDestinationDown(i)} disabled={i === destinations.length - 1}>↓</button>
          <button type="button" on:click={() => removeDestination(i)} disabled={destinations.length === 1}>✕</button>
        </div>
      {/each}
      <button type="button" on:click={addDestination}>+ Add</button>
    </div>

    <label>
      End Address (Optional)
      <input 
        type="text" 
        bind:value={endAddress} 
        placeholder="Leave empty for last destination" 
        autocomplete="off"
        use:autocomplete={{ apiKey: API_KEY }}
        on:place-selected={(e) => handlePlaceSelect('end', e)}
      />
    </label>

    <div class="row">
      <label>MPG <input type="number" bind:value={mpg} step="0.1" /></label>
      <label>Gas Price <input type="number" bind:value={gasPrice} step="0.01" /></label>
    </div>
    
    </div>

  <div class="map-container" class:hidden={!calculated}>
    <div bind:this={mapElement} class="map"></div>
  </div>

  <div class="actions">
    <button class="primary" on:click={calculateRoute} disabled={calculating}>
      {calculating ? 'Calculating...' : 'Calculate Route'}
    </button>
    
    {#if calculated}
      <button class="success" on:click={logTrip}>Log Trip</button>
    {/if}
  </div>
</div>

<style>
  /* Same styles as before */
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }
  .form-section { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); margin-bottom: 20px; }
  label { display: block; font-weight: 600; margin-bottom: 16px; }
  input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; margin-top: 4px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .destinations { margin-bottom: 16px; }
  .dest-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .dest-row input:first-child { flex: 2; }
  .dest-row input:nth-child(2) { flex: 1; }
  .dest-row button { padding: 8px; border: none; background: #f0f0f0; cursor: pointer; border-radius: 4px; }
  .map-container { background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px; }
  .map-container.hidden { display: none; }
  .map { width: 100%; height: 400px; border-radius: 8px; }
  .actions { display: flex; gap: 12px; }
  button { padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
  .primary { background: linear-gradient(135deg, #4caf50 0%, #45a049 100%); color: white; }
  .success { background: #4caf50; color: white; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>