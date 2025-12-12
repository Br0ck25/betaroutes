// src/lib/components/trip/TripForm.svelte
<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { get } from 'svelte/store';
  import { onMount, tick } from 'svelte';
  import type { Destination, MaintenanceCost, SupplyCost } from '$lib/types';
  import { calculateTripTotals } from '$lib/utils/calculations';
  import { storage } from '$lib/utils/storage';
  import { trips, draftTrip } from '$lib/stores/trips';
  import { user } from '$lib/stores/auth';
  import { autocomplete } from '$lib/utils/autocomplete';

  export let googleApiKey = '';
  const settings = get(userSettings);
  const API_KEY = googleApiKey || 'dummy_key';
  // Google Maps is loaded by the autocomplete action

  // Default form values
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

  let calculating = false;
  let calculated = false;
  
  // Results placeholders
  let totalMileage = 0;
  let totalTime = '';
  let totalEarnings = 0;
  let fuelCost = 0;
  let maintenanceCost = 0;
  let suppliesCost = 0;
  let netProfit = 0;
  let profitPerHour = 0;
  let hoursWorked = 0;
  // No Map Element variables needed for pure KV test

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
    const draft = draftTrip.load();
    if (draft && confirm('Resume your last unsaved trip?')) {
      loadDraft(draft);
    }
    const autoSaveInterval = setInterval(() => saveDraft(), 5000);
    return () => clearInterval(autoSaveInterval);
  });

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
    if (!startAddress) {
      alert("Please enter a start address.");
      return;
    }

    // Check if Google Maps is available
    if (typeof google === 'undefined' || !google.maps || !google.maps.DirectionsService) {
      alert("Google Maps API is not loaded yet. Please wait a moment.");
      return;
    }

    calculating = true;

    try {
      const directionsService = new google.maps.DirectionsService();
      
      // Filter out empty destinations
      const validDestinations = destinations.filter(d => d.address && d.address.trim() !== '');
      
      // Construct Waypoints
      const waypoints = validDestinations.map(d => ({
        location: d.address,
        stopover: true
      }));

      // Determine final destination
      // If endAddress is provided, use it. Otherwise, return to start (round trip) or last stop.
      // For now, if no end address, we'll assume the last destination is the end, 
      // or if explicitly requested, a round trip back to start.
      // Current logic: Use endAddress if set, otherwise use last destination as the "end" of the route request.
      
      let origin = startAddress;
      let destination = endAddress;

      // If no end address is typed, use the last destination as the endpoint
      // and remove it from waypoints to avoid duplication
      if (!destination && waypoints.length > 0) {
        destination = waypoints[waypoints.length - 1].location as string;
        waypoints.pop();
      } else if (!destination && waypoints.length === 0) {
        // Only start address? Cannot calculate route.
        alert("Please add at least one destination or an end address.");
        calculating = false;
        return;
      }

      const request: google.maps.DirectionsRequest = {
        origin: origin,
        destination: destination,
        waypoints: waypoints,
        optimizeWaypoints: true, // Optimizes the order of stops for efficiency
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: distanceUnit === 'km' ? google.maps.UnitSystem.METRIC : google.maps.UnitSystem.IMPERIAL
      };

      directionsService.route(request, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          // Calculate totals from legs
          const route = result.routes[0];
          let distanceMeters = 0;
          let durationSeconds = 0;

          route.legs.forEach(leg => {
            if (leg.distance) distanceMeters += leg.distance.value;
            if (leg.duration) durationSeconds += leg.duration.value;
          });

          // Convert to miles/minutes
          // 1 meter = 0.000621371 miles
          const totalMiles = distanceMeters * 0.000621371;
          const totalMinutes = durationSeconds / 60;

          // Update State
          totalMileage = parseFloat(totalMiles.toFixed(1));
          
          // Use the utility to calculate costs/profits
          const totals = calculateTripTotals(
            totalMileage,
            totalMinutes,
            destinations,
            mpg,
            gasPrice,
            maintenanceItems,
            supplyItems,
            startTime,
            endTime
          );

          totalTime = totals.totalTime || '';
          fuelCost = totals.fuelCost || 0;
          netProfit = totals.netProfit || 0;
          totalEarnings = totals.totalEarnings || 0;
          
          calculated = true;
        } else {
          console.error("Directions request failed due to " + status);
          alert("Could not calculate route. Check addresses and try again.");
        }
        calculating = false;
      });

    } catch (error) {
      console.error("Route calculation error:", error);
      alert("An error occurred while calculating route.");
      calculating = false;
    }
  }

  async function logTrip() {
    alert("Log Trip disabled until Routing is re-enabled.");
  }

  async function resetForm() {
    date = new Date().toISOString().split('T')[0];
    startTime = '';
    endTime = '';
    notes = '';
    destinations = [{ address: '', earnings: 0 }];
    calculated = false;
    totalMileage = 0;
    totalTime = '';
    fuelCost = 0;
    netProfit = 0;
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
  <h2>Plan Your Trip (KV Test Mode)</h2>
  
  <div class="form-section">
    <div style="background: #e3f2fd; color: #0d47a1; padding: 12px; margin-bottom: 20px; border-radius: 8px; font-size: 14px;">
      <strong>Test Instructions:</strong>
      <ul style="margin: 5px 0 0 20px;">
         <li>Type <code>test</code> to verify API connection.</li>
         <li>Type <code>101</code> to verify KV data access (based on your logs).</li>
      </ul>
    </div>

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

    <div class="row">
      <label>Start Time <input type="time" bind:value={startTime} /></label>
      <label>End Time <input type="time" bind:value={endTime} /></label>
    </div>

    <label>
      Notes
      <textarea bind:value={notes} rows="3"></textarea>
    </label>
  </div>

  {#if calculated}
    <div class="form-section" style="background: #f0fdf4; border: 1px solid #bbf7d0;">
      <h3>Trip Summary</h3>
      <div class="row">
        <div><strong>Total Distance:</strong> {totalMileage} {distanceUnit}</div>
        <div><strong>Est. Time:</strong> {totalTime}</div>
        <div><strong>Fuel Cost:</strong> ${fuelCost}</div>
        <div><strong>Net Profit:</strong> ${netProfit}</div>
      </div>
    </div>
  {/if}

  <div class="actions">
    <button 
      class="primary" 
      on:click={calculateRoute} 
      disabled={calculating}
      style={calculating ? "opacity: 0.7; cursor: wait;" : "background: #2563eb; color: white;"}
    >
      {calculating ? 'Calculating...' : 'Calculate Route'}
    </button>
  </div>
</div>

<style>
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
  .actions { display: flex; gap: 12px; }
  button { padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
  .primary { background: #999; color: white; }
  button:disabled { opacity: 0.5; }
</style>