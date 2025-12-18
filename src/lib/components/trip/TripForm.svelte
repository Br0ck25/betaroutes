<script lang="ts">
  import { userSettings } from '$lib/stores/userSettings';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import type { Destination, Trip, LatLng } from '$lib/types';
  import { calculateTripTotals } from '$lib/utils/calculations';
  import { storage } from '$lib/utils/storage';
  import { draftTrip } from '$lib/stores/trips';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { calculateRoute as getRouteData } from '$lib/services/maps';
  import DestinationList from './DestinationList.svelte';
  import TripSummary from './TripSummary.svelte';
  import TripDebug from './TripDebug.svelte';
  import { toasts } from '$lib/stores/toast';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';

  // Svelte 5 Props using Runes
  let { googleApiKey = '', loading = false } = $props();
   
  const settings = get(userSettings);
  const API_KEY = googleApiKey || 'dummy_key';

  // --- Form State (Runes) ---
  let date = $state(new Date().toISOString().split('T')[0]);
  let startTime = $state('');
  let endTime = $state('');
   
  let startAddress = $state(settings.startLocation || storage.getSetting('defaultStartAddress') || '');
  let endAddress = $state(settings.endLocation || storage.getSetting('defaultEndAddress') || '');
   
  // Coordinates State
  let startLocation = $state<LatLng | undefined>(undefined);
  let endLocation = $state<LatLng | undefined>(undefined);
   
  let mpg = $state(settings.defaultMPG ?? storage.getSetting('defaultMPG') ?? 25);
  let gasPrice = $state(settings.defaultGasPrice ?? storage.getSetting('defaultGasPrice') ?? 3.5);
  let distanceUnit = $state(settings.distanceUnit || 'mi');
   
  // Destinations State
  let destinations = $state<Destination[]>([{ address: '', earnings: 0 }]);
  let notes = $state('');

  // --- Calculation State (Runes) ---
  let calculating = $state(false);
  let calculated = $state(false);
  let calculationError = $state('');
   
  let totalMileage = $state(0);
  let totalTime = $state('');
  let fuelCost = $state(0);
  let netProfit = $state(0);

  // --- Auto-Calculation Effect ---
  $effect(() => {
    const _deps = { startAddress, endAddress, destinations, mpg, gasPrice };
    const hasStart = startAddress && startAddress.length > 3;
    const hasDest = destinations.length > 0 && destinations[0].address.length > 3;

    if (hasStart && hasDest) {
        const timer = setTimeout(() => {
            handleCalculate(true); // true = silent mode
        }, 1500);
        return () => clearTimeout(timer);
    }
  });

  // --- Handlers ---
  function handleAddressSelect(field: 'start' | 'end', e: CustomEvent) {
    const place = e.detail;
    const val = place.formatted_address || place.name || '';
    
    let location: LatLng | undefined;
    if (place.geometry && place.geometry.location) {
        const lat = typeof place.geometry.location.lat === 'function' ?
            place.geometry.location.lat() : place.geometry.location.lat;
        const lng = typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng;
        location = { lat, lng };
    }

    if (field === 'start') {
        startAddress = val;
        startLocation = location;
    } else {
        endAddress = val;
        endLocation = location;
    }
  }

  async function handleCalculate(silent = false) {
    if (!startAddress) {
        if (!silent) toasts.error("Please enter a start address.");
        return;
    }

    calculating = true;
    calculationError = '';
    
    try {
        const effectiveEndAddress = endAddress ? endAddress : startAddress;
        const destsCopy = $state.snapshot(destinations);

        const routeData = await getRouteData(startAddress, effectiveEndAddress, destsCopy, distanceUnit as 'mi'|'km');
        
        totalMileage = routeData.totalMiles;
        
        const totals = calculateTripTotals(
            totalMileage,
            routeData.totalMinutes,
            destsCopy,
            mpg,
            gasPrice,
            [], 
            [], 
            startTime,
            endTime
        );

        totalTime = totals.totalTime || '';
        fuelCost = totals.fuelCost || 0;
        netProfit = totals.netProfit || 0;
        calculated = true;

        if (!silent) toasts.success("Route calculated successfully!");
        
        return routeData;

    } catch (err: any) {
        console.error("Calculation Error:", err);
        const msg = err.message || "Failed to calculate route.";
        
        if (!silent || !msg.includes('ZERO_RESULTS')) {
             calculationError = msg;
             if (!silent) toasts.error(msg);
        }
        return null;
    } finally {
        calculating = false;
    }
  }
  
  async function handleOptimize() {
    if (!startAddress) {
        toasts.error("Please enter a start address first.");
        return;
    }

    const validDests = destinations.filter(d => d.address && d.address.trim() !== '');
    if (validDests.length < 2) {
        toasts.error("Need at least 2 stops to optimize.");
        return;
    }

    calculating = true;

    try {
        const result = await handleCalculate(true); 
        
        if (result && result.optimizedOrder && result.optimizedOrder.length > 0) {
            const currentDestinations = $state.snapshot(destinations);
            const validDestinations = currentDestinations.filter(d => d.address && d.address.trim() !== '');
            const emptyDestinations = currentDestinations.filter(d => !d.address || d.address.trim() === '');
            
            let waypointsToReorder: Destination[] = [];
            let fixedEnd: Destination | null = null;

            if (!endAddress) {
                fixedEnd = validDestinations[validDestinations.length - 1];
                waypointsToReorder = validDestinations.slice(0, -1);
            } else {
                waypointsToReorder = validDestinations;
            }

            const reorderedWaypoints = result.optimizedOrder.map((index: number) => waypointsToReorder[index]);
            let newDestinations = [...reorderedWaypoints];
            
            if (fixedEnd) {
                newDestinations.push(fixedEnd);
            }

            newDestinations = [...newDestinations, ...emptyDestinations];
            destinations = newDestinations;
            
            toasts.success("Stops optimized for fastest route!");
        } else {
            toasts.info("Route is already optimized or could not be improved.");
        }

    } catch (e: any) {
        console.error("Optimization failed:", e);
        toasts.error("Failed to optimize stops.");
    } finally {
        calculating = false;
    }
  }

  // --- Draft Logic ---
  function loadDraft(draft: Partial<Trip>) {
    if (!draft || typeof draft !== 'object') return;
    if (draft.date) date = draft.date;
    if (draft.startTime) startTime = draft.startTime;
    if (draft.endTime) endTime = draft.endTime;
    if (draft.startAddress) startAddress = draft.startAddress;
    if (draft.endAddress) endAddress = draft.endAddress;
    if (draft.startLocation) startLocation = draft.startLocation;
    if (draft.endLocation) endLocation = draft.endLocation;
    if (draft.mpg) mpg = draft.mpg;
    if (draft.gasPrice) gasPrice = draft.gasPrice;
    if (draft.destinations && Array.isArray(draft.destinations)) destinations = draft.destinations;
    if (draft.notes) notes = draft.notes;
  }

  function saveDraft() {
    const draftData: Partial<Trip> = { 
      date, startTime, endTime, startAddress, endAddress, 
      startLocation, endLocation, destinations, mpg, gasPrice, notes 
    };
    draftTrip.save(draftData);
  }

  onMount(() => {
    const rawDraft = draftTrip.load();
    if (rawDraft && confirm('Resume your last unsaved trip?')) {
        loadDraft(rawDraft as Partial<Trip>);
    }
    const interval = setInterval(saveDraft, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6">
  <h2 class="text-2xl font-bold mb-6">Plan Your Trip</h2>
  
  <TripDebug />

  <div class="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 mb-6 space-y-6">
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
            <label class="block font-semibold mb-2 text-sm text-gray-700">Date</label>
            {#if loading}
              <Skeleton height="48px" className="rounded-lg" />
            {:else}
              <input 
                type="date" 
                bind:value={date} 
                class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" 
              />
            {/if}
        </div>
    </div>

    <div>
      <label class="block font-semibold mb-2 text-sm text-gray-700">Start Address</label>
      {#if loading}
        <Skeleton height="48px" className="rounded-lg" />
      {:else}
        <input 
            type="text" 
            bind:value={startAddress} 
            placeholder="Enter start location" 
            class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
            autocomplete="off" 
            use:autocomplete={{ apiKey: API_KEY }}
            on:place-selected={(e) => handleAddressSelect('start', e)}
        />
      {/if}
    </div>

    {#if loading}
        <div class="space-y-3">
             <label class="block font-semibold text-sm text-gray-700">Destinations</label>
             <Skeleton height="50px" className="rounded-lg" />
             <Skeleton height="50px" className="rounded-lg" />
        </div>
    {:else}
        <DestinationList 
            bind:destinations 
            apiKey={API_KEY} 
        />
    {/if}

    <div>
      <label class="block font-semibold mb-2 text-sm text-gray-700">End Address (Optional)</label>
      {#if loading}
         <Skeleton height="48px" className="rounded-lg" />
      {:else}
          <input 
            type="text" 
            bind:value={endAddress} 
            placeholder="Leave empty to return to Start" 
            class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
            autocomplete="off"
            use:autocomplete={{ apiKey: API_KEY }}
            on:place-selected={(e) => handleAddressSelect('end', e)}
          />
      {/if}
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block font-semibold mb-2 text-sm text-gray-700">MPG</label>
        {#if loading}
           <Skeleton height="48px" className="rounded-lg" />
        {:else}
           <input 
             type="number" 
             bind:value={mpg} 
             step="0.1" 
             class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" 
           />
        {/if}
      </div>
      <div>
        <label class="block font-semibold mb-2 text-sm text-gray-700">Gas Price ($)</label>
        {#if loading}
           <Skeleton height="48px" className="rounded-lg" />
        {:else}
           <input 
             type="number" 
             bind:value={gasPrice} 
             step="0.01" 
             class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" 
           />
        {/if}
      </div>
      <div>
        <label class="block font-semibold mb-2 text-sm text-gray-700">Start Time</label>
        {#if loading}
           <Skeleton height="48px" className="rounded-lg" />
        {:else}
           <input 
             type="time" 
             bind:value={startTime} 
             class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" 
           />
        {/if}
      </div>
      <div>
        <label class="block font-semibold mb-2 text-sm text-gray-700">End Time</label>
        {#if loading}
           <Skeleton height="48px" className="rounded-lg" />
        {:else}
           <input 
             type="time" 
             bind:value={endTime} 
             class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all" 
           />
        {/if}
      </div>
    </div>

    <div>
      <label class="block font-semibold mb-2 text-sm text-gray-700">Notes</label>
      {#if loading}
         <Skeleton height="100px" className="rounded-lg" />
      {:else}
         <textarea 
           bind:value={notes} 
           rows="3" 
           class="w-full p-3 text-base border-gray-300 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
         ></textarea>
      {/if}
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
  {:else if calculating}
    <div class="p-6 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
        <div class="inline-block animate-spin mr-2">⟳</div> Calculating route...
    </div>
  {/if}

  <div class="flex flex-col sm:flex-row gap-3 mt-6">
    {#if loading}
        <Skeleton height="48px" width="160px" className="rounded-lg" />
    {:else}
        <button 
          class="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          on:click={() => handleCalculate(false)} 
          disabled={calculating}
        >
          {calculating ? 'Calculating...' : 'Recalculate Route'}
        </button>
        
        <button 
          class="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          on:click={handleOptimize} 
          disabled={calculating || destinations.length < 2}
          title="Reorder stops for fastest route"
        >
          Optimize Stops
        </button>
    {/if}
  </div>
</div>