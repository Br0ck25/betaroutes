<script lang="ts">
  import type { Destination, GeocodeResult } from '$lib/types';
  import { autocomplete } from '$lib/utils/autocomplete';
  import { createEventDispatcher } from 'svelte';

  export let destinations: Destination[] = [{ address: '', earnings: 0 }];
  export let apiKey: string = '';

  const dispatch = createEventDispatcher();
  function handlePlaceSelect(index: number, e: CustomEvent) {
    const place = e.detail as GeocodeResult;
    if (!destinations || !destinations[index]) return;
    const dest = destinations[index]!;
    dest.address = place.formatted_address || place.name || '';
    // Extract Lat/Lng
    if (place.geometry && place.geometry.location) {
        const latRaw = (place.geometry.location as any).lat;
        const lngRaw = (place.geometry.location as any).lng;
        const lat = typeof latRaw === 'function' ? (latRaw as unknown as () => number)() : (latRaw as number);
        const lng = typeof lngRaw === 'function' ? (lngRaw as unknown as () => number)() : (lngRaw as number);
        dest.location = { lat, lng };
    }

    // Trigger reactivity in parent
    dispatch('update', destinations);
  }

  function addDestination() {
    destinations = [...(destinations || []), { address: '', earnings: 0 }];
    dispatch('update', destinations);
  }

  function removeDestination(index: number) {
    if (destinations.length > 1) {
      destinations = destinations.filter((_, i) => i !== index);
      dispatch('update', destinations);
    }
  }

  function moveUp(index: number) {
    if (index > 0 && destinations && destinations[index] && destinations[index - 1]) {
      const current = destinations[index] as Destination;
      const prev = destinations[index - 1] as Destination;
      destinations[index] = prev;
      destinations[index - 1] = current;
      destinations = [...destinations]; // Trigger reactivity
      dispatch('update', destinations);
    }
  }

  function moveDown(index: number) {
    if (destinations && index < destinations.length - 1 && destinations[index] && destinations[index + 1]) {
      const current = destinations[index] as Destination;
      const next = destinations[index + 1] as Destination;
      destinations[index] = next;
      destinations[index + 1] = current;
      destinations = [...destinations];
      dispatch('update', destinations);
    }
  }

  // Action to listen for 'place-selected' events (used instead of mixing deprecated/new event syntaxes)
  function placeSelector(node: HTMLElement, cb: (e: CustomEvent) => void) {
    const handler = (ev: Event) => cb(ev as CustomEvent);
    node.addEventListener('place-selected', handler);
    return { destroy() { node.removeEventListener('place-selected', handler); } };
  }
</script>

<div class="destinations-container">
  <h3 class="block font-semibold mb-4 text-sm text-gray-700">Destinations</h3>
  
  {#each destinations as dest, i}
    <div class="dest-row flex gap-2 mb-3"> <input 
        type="text" 
        bind:value={dest.address} 
        placeholder="Destination address" 
        class="flex-2 w-full p-3 text-base border border-gray-300 rounded-lg" 
        autocomplete="off"
        use:autocomplete={{ apiKey }}
        use:placeSelector={(e: CustomEvent) => handlePlaceSelect(i, e)}
      />
      <input 
        type="number" 
        bind:value={dest.earnings} 
        placeholder="$" 
        step="0.01"
        class="flex-1 w-24 p-3 text-base border border-gray-300 rounded-lg"
      />
      <div class="flex gap-1">
        <button type="button" onclick={() => moveUp(i)} disabled={i === 0} class="p-3 bg-gray-100 rounded-lg disabled:opacity-50 active:bg-gray-200 transition-colors">↑</button>
        <button type="button" onclick={() => moveDown(i)} disabled={i === destinations.length - 1} class="p-3 bg-gray-100 rounded-lg disabled:opacity-50 active:bg-gray-200 transition-colors">↓</button>
        <button type="button" onclick={() => removeDestination(i)} disabled={destinations.length === 1} class="p-3 bg-red-50 text-red-600 rounded-lg disabled:opacity-50 active:bg-red-100 transition-colors">✕</button>
      </div>
    </div>
  {/each}

  <button type="button" onclick={addDestination} class="mt-2 text-blue-600 font-semibold text-sm hover:underline py-2">+ Add Destination</button>
</div>