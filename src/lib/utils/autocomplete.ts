// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

let googleLoaded = false;
let mapsLoadingPromise: Promise<void> | null = null;

// Helper to ensure Google Maps is loaded
export function loadGoogle(apiKey: string): Promise<void> {
  if (googleLoaded) return Promise.resolve();
  if (mapsLoadingPromise) return mapsLoadingPromise;

  mapsLoadingPromise = new Promise((resolve) => {
    if (typeof google !== "undefined" && google.maps && google.maps.places) {
      googleLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => {
      googleLoaded = true;
      resolve();
    };
    document.head.appendChild(script);
  });
  return mapsLoadingPromise;
}

/**
 * Svelte Action for "Local First" Autocomplete
 * 1. Checks BETA_PLACES_KV via API
 * 2. Falls back to Google Maps Autocomplete
 */
export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let instance: google.maps.places.Autocomplete | null = null;
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;

  async function init() {
    if (!params?.apiKey) return;
    
    await loadGoogle(params.apiKey);

    // 1. Initialize Google Autocomplete (The Fallback)
    // We attach it to the node so standard Google predictions work if local fails
    instance = new google.maps.places.Autocomplete(node, {
      types: ["geocode"],
      fields: ["formatted_address", "geometry", "name"],
    });

    // Listen for Google's selection event
    instance.addListener("place_changed", () => {
      const place = instance!.getPlace();
      triggerSelection(place);
    });

    // 2. Initialize Local KV Search (The Priority)
    setupLocalSearch();
  }

  function setupLocalSearch() {
    // Create the custom dropdown element
    suggestionsList = document.createElement('ul');
    Object.assign(suggestionsList.style, {
      position: 'absolute',
      zIndex: '2147483647', // Ensure it sits above Google's .pac-container (usually 1000)
      backgroundColor: 'white',
      border: '1px solid #ddd',
      borderRadius: '0 0 8px 8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      listStyle: 'none',
      padding: '0',
      margin: '0',
      width: '100%',
      maxHeight: '250px',
      overflowY: 'auto',
      display: 'none',
      fontSize: '14px',
      fontFamily: 'inherit'
    });
    
    // Append to body to avoid overflow:hidden issues in parents
    document.body.appendChild(suggestionsList);

    // Event Listeners
    node.addEventListener('input', handleInput);
    node.addEventListener('focus', handleInput);
    node.addEventListener('blur', () => {
      // Small delay to allow clicking an item before the list disappears
      setTimeout(() => {
        if(suggestionsList) suggestionsList.style.display = 'none';
      }, 200);
    });
  }

  function handleInput() {
    const query = node.value;
    
    // Update Position (Input might move)
    if (suggestionsList) {
      const rect = node.getBoundingClientRect();
      Object.assign(suggestionsList.style, {
        top: `${rect.bottom + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`
      });
    }

    // Hide if empty
    if (!query || query.length < 2) {
      if(suggestionsList) suggestionsList.style.display = 'none';
      return;
    }

    // Debounce the API call
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        renderSuggestions(results);
      } catch (err) {
        console.error('Local autocomplete error', err);
      }
    }, 200);
  }

  function renderSuggestions(items: any[]) {
    if (!suggestionsList) return;
    
    suggestionsList.innerHTML = '';
    
    if (!items || items.length === 0) {
      suggestionsList.style.display = 'none';
      return;
    }

    // Header for Local Results
    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '4px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: '#666',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #eee'
    });
    header.textContent = 'SAVED PLACES';
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.2em;">🕒</span> 
          <span style="font-weight: 500;">${item.formatted_address || item.name}</span>
        </div>
      `;
      
      Object.assign(li.style, {
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee',
        color: '#333',
        transition: 'background 0.1s'
      });
      
      li.addEventListener('mouseenter', () => li.style.backgroundColor = '#eef2f6');
      li.addEventListener('mouseleave', () => li.style.backgroundColor = 'white');
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent focus loss
        selectLocalItem(item);
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
  }

  function selectLocalItem(item: any) {
    const text = item.formatted_address || item.name;
    
    // Create a mock Google Place object
    // Note: We might not have 'geometry' stored locally, but DirectionsService 
    // handles string addresses perfectly fine, so we just pass the text.
    const place = {
      formatted_address: text,
      name: text,
      geometry: item.geometry || undefined
    };
    
    triggerSelection(place);
  }

  function triggerSelection(place: any) {
    // Hide our custom list
    if(suggestionsList) suggestionsList.style.display = 'none';
    
    // Update input value
    node.value = place.formatted_address || place.name;

    // Dispatch event for Svelte binding
    node.dispatchEvent(new CustomEvent('place-selected', { detail: place }));
  }

  init();

  return {
    destroy() {
      if (suggestionsList) suggestionsList.remove();
      if (instance) google.maps.event.clearInstanceListeners(instance);
      node.removeEventListener('input', handleInput);
      node.removeEventListener('focus', handleInput);
    }
  };
};