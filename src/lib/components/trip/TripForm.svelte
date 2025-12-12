<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { get } from 'svelte/store';
  import { onMount, tick } from 'svelte';
  // [!code ++] Added Trip to imports
  import type { Destination, MaintenanceCost, SupplyCost, Trip } from '$lib/types';
  import { calculateTripTotals } from '$lib/utils/calculations';
  import { storage } from '$lib/utils/storage';
  import { draftTrip } from '$lib/stores/trips';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { calculateRoute as getRouteData } from '$lib/services/maps';
  import DestinationList from './DestinationList.svelte';
  import TripSummary from './TripSummary.svelte';
  import TripDebug from './TripDebug.svelte';
  import { toasts } from '$lib/stores/toast';

  export let googleApiKey = '';
  const settings = get(userSettings);
  const API_KEY = googleApiKey || 'dummy_key';

  // --- Form State ---
  let date = new Date().toISOString().split('T')[0];
  let startTime = '';
  let endTime = '';
  let startAddress = settings.startLocation || storage.getSetting('defaultStartAddress') || '';
  let endAddress = settings.endLocation || storage.getSetting('defaultEndAddress') || '';
  let mpg = settings.defaultMPG ?? storage.getSetting('defaultMPG') ?? 25;
  let gasPrice = settings.defaultGasPrice ?? storage.getSetting('defaultGasPrice') ?? 3.5;
  let distanceUnit = settings.distanceUnit || 'mi';
  let destinations: Destination[] = [{ address: '', earnings: 0 }];
  let notes = '';

  // --- Calculation State ---
  let calculating = false;
  let calculated = false;
  let calculationError = '';
  
  let totalMileage = 0;
  let totalTime = '';
  let fuelCost = 0;
  let netProfit = 0;

  // --- Handlers ---

  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const place = e.detail;
    const val = place.formatted_address || place.name || '';
    if (field === 'start') startAddress = val;
    else endAddress = val;
  }

  async function handleCalculate() {
    calculating = true;
    calculationError = '';
    calculated = false;

    if (!startAddress) {
        toasts.error("Please enter a start address.");
        calculating = false;
        return;
    }

    try {
        // 1. Get raw route data from service
        const routeData = await getRouteData(startAddress, endAddress, destinations, distanceUnit as 'mi'|'km');
        
        // 2. Update state with map results
        totalMileage = routeData.totalMiles;
        
        // 3. Calculate Financials
        const totals = calculateTripTotals(
            totalMileage,
            routeData.totalMinutes,
            destinations,
            mpg,
            gasPrice,
            [], // maintenance (add back if needed)
            [], // supplies
            startTime,
            endTime
        );

        totalTime = totals.totalTime || '';
        fuelCost = totals.fuelCost || 0;
        netProfit = totals.netProfit || 0;
        calculated = true;
        
        toasts.success("Route calculated successfully!");

    } catch (err: any) {
        console.error("Calculation Error:", err);
        const msg = err.message || "Failed to calculate route.";
        calculationError = msg;
        toasts.error(msg);
    } finally {
        calculating = false;
    }
  }

  // --- Draft Logic ---

  /**
   * Type-safe draft loader.
   * Maps properties from Partial<Trip> to local state variables.
   */
  function loadDraft(draft: Partial<Trip>) {
    if (!draft || typeof draft !== 'object') return;

    // We check existence to ensure we don't overwrite defaults with undefined
    if (draft.date) date = draft.date;
    if (draft.startTime) startTime = draft.startTime;
    if (draft.endTime) endTime = draft.endTime;
    if (draft.startAddress) startAddress = draft.startAddress;
    if (draft.endAddress) endAddress = draft.endAddress;
    if (draft.mpg) mpg = draft.mpg;
    if (draft.gasPrice) gasPrice = draft.gasPrice;
    if (draft.destinations && Array.isArray(draft.destinations)) destinations = draft.destinations;
    if (draft.notes) notes = draft.notes;
    
    // Optional: Log success or trigger a toast if you want visual confirmation
    // console.log('Draft loaded safely');
  }

  function saveDraft() {
    // Construct an object that matches Partial<Trip>
    const draftData: Partial<Trip> = { 
      date, 
      startTime, 
      endTime, 
      startAddress, 
      endAddress, 
      destinations, 
      mpg, 
      gasPrice, 
      notes 
    };
    draftTrip.save(draftData);
  }

  onMount(() => {
    // Retrieve draft (assumed to be 'any' or 'unknown' from storage)
    const rawDraft = draftTrip.load();
    
    if (rawDraft && confirm('Resume your last unsaved trip?')) {
        // Cast to Partial<Trip> for the safe loader
        loadDraft(rawDraft as Partial<Trip>);
    }
    
    const interval = setInterval(saveDraft, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="max-w-4xl mx-auto p-5">
  <h2 class="text-2xl font-bold mb-6">Plan Your Trip</h2>
  
  <TripDebug />

  <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-6 space-y-6">
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
            <label class="block font-semibold mb-2">Date</label>
            <input type="date" bind:value={date} class="w-full p-2 border rounded" />
        </div>
    </div>

    <div>
      <label class="block font-semibold mb-2">Start Address</label>
      <input 
        type="text" 
        bind:value={startAddress} 
        placeholder="Enter start location" 
        class="w-full p-2 border rounded"
        autocomplete="off" 
        use:autocomplete={{ apiKey: API_KEY }}
        on:place-selected={(e) => handleAddressSelect('start', e)}
      />
    </div>

    <DestinationList 
        bind:destinations 
        apiKey={API_KEY} 
    />

    <div>
      <label class="block font-semibold mb-2">End Address (Optional)</label>
      <input 
        type="text" 
        bind:value={endAddress} 
        placeholder="Leave empty to end at last stop" 
        class="w-full p-2 border rounded"
        autocomplete="off"
        use:autocomplete={{ apiKey: API_KEY }}
        on:place-selected={(e) => handleAddressSelect('end', e)}
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block font-semibold mb-2">MPG</label>
        <input type="number" bind:value={mpg} step="0.1" class="w-full p-2 border rounded" />
      </div>
      <div>
        <label class="block font-semibold mb-2">Gas Price ($)</label>
        <input type="number" bind:value={gasPrice} step="0.01" class="w-full p-2 border rounded" />
      </div>
      <div>
        <label class="block font-semibold mb-2">Start Time</label>
        <input type="time" bind:value={startTime} class="w-full p-2 border rounded" />
      </div>
      <div>
        <label class="block font-semibold mb-2">End Time</label>
        <input type="time" bind:value={endTime} class="w-full p-2 border rounded" />
      </div>
    </div>

    <div>
      <label class="block font-semibold mb-2">Notes</label>
      <textarea bind:value={notes} rows="3" class="w-full p-2 border rounded"></textarea>
    </div>
  </div>

  {#if calculationError}
    <div class="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200">
        {calculationError}
    </div>
  {/if}

  {#if calculated}
    <TripSummary 
        {totalMileage} 
        {distanceUnit} 
        {totalTime} 
        {fuelCost} 
        {netProfit} 
    />
  {/if}

  <div class="flex gap-3">
    <button 
      class="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      on:click={handleCalculate} 
      disabled={calculating}
    >
      {calculating ? 'Calculating...' : 'Calculate Route'}
    </button>
  </div>
</div>