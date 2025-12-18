<script lang="ts">
  import type { Destination } from '$lib/types';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { createEventDispatcher } from 'svelte';

  export let destinations: Destination[];
  export let apiKey: string;

  const dispatch = createEventDispatcher();
  function handlePlaceSelect(index: number, e: CustomEvent) {
    const place = e.detail;
    destinations[index].address = place.formatted_address || place.name || '';
    // Extract Lat/Lng
    if (place.geometry && place.geometry.location) {
        const lat = typeof place.geometry.location.lat === 'function' ?
            place.geometry.location.lat() : place.geometry.location.lat;
        const lng = typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng;
        destinations[index].location = { lat, lng };
    }

    // Trigger reactivity in parent
    dispatch('update', destinations);
  }

  function addDestination() {
    destinations = [...destinations, { address: '', earnings: 0 }];
    dispatch('update', destinations);
  }

  function removeDestination(index: number) {
    if (destinations.length > 1) {
      destinations = destinations.filter((_, i) => i !== index);
      dispatch('update', destinations);
    }
  }

  function moveUp(index: number) {
    if (index > 0) {
      [destinations[index], destinations[index - 1]] = [destinations[index - 1], destinations[index]];
      destinations = [...destinations]; // Trigger reactivity
      dispatch('update', destinations);
    }
  }

  function moveDown(index: number) {
    if (index < destinations.length - 1) {
      [destinations[index], destinations[index + 1]] = [destinations[index + 1], destinations[index]];
      destinations = [...destinations];
      dispatch('update', destinations);
    }
  }
</script>

<div class="destinations-container">
  <label class="block font-semibold mb-4 text-sm text-gray-700">Destinations</label>
  
  {#each destinations as dest, i}
    <div class="dest-row flex gap-2 mb-3"> <input 
        type="text" 
        bind:value={dest.address} 
        placeholder="Destination address" 
        class="flex-2 w-full p-3 text-base border border-gray-300 rounded-lg" 
        autocomplete="off"
        use:autocomplete={{ apiKey }}
        on:place-selected={(e) => handlePlaceSelect(i, e)}
      />
      <input 
        type="number" 
        bind:value={dest.earnings} 
        placeholder="$" 
        step="0.01"
        class="flex-1 w-24 p-3 text-base border border-gray-300 rounded-lg"
      />
      <div class="flex gap-1">
        <button type="button" on:click={() => moveUp(i)} disabled={i === 0} class="p-3 bg-gray-100 rounded-lg disabled:opacity-50 active:bg-gray-200 transition-colors">↑</button>
        <button type="button" on:click={() => moveDown(i)} disabled={i === destinations.length - 1} class="p-3 bg-gray-100 rounded-lg disabled:opacity-50 active:bg-gray-200 transition-colors">↓</button>
        <button type="button" on:click={() => removeDestination(i)} disabled={destinations.length === 1} class="p-3 bg-red-50 text-red-600 rounded-lg disabled:opacity-50 active:bg-red-100 transition-colors">✕</button>
      </div>
    </div>
  {/each}

  <button type="button" on:click={addDestination} class="mt-2 text-blue-600 font-semibold text-sm hover:underline py-2">+ Add Destination</button>
</div>