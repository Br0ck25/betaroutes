// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

let googleLoaded = false;
let mapsLoadingPromise: Promise<void> | null = null;

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
    script.onerror = (e) => console.error("Google Maps failed to load", e);
    document.head.appendChild(script);
  });
  return mapsLoadingPromise;
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let instance: google.maps.places.Autocomplete | null = null;
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;

  function init() {
    console.log('[Autocomplete] Initializing...');

    // 1. Setup Local Search IMMEDIATELY (Don't wait for Google)
    setupLocalSearch();

    // 2. Load Google in the background
    if (params?.apiKey) {
        loadGoogle(params.apiKey).then(() => {
            console.log('[Autocomplete] Google Maps loaded. Attaching fallback.');
            
            // Attach Google Autocomplete as a fallback
            instance = new google.maps.places.Autocomplete(node, {
                types: ["geocode"],
                fields: ["formatted_address", "geometry", "name"],
            });

            // Listen for Google's selection
            instance.addListener("place_changed", () => {
                const place = instance!.getPlace();
                console.log('[Autocomplete] Google Place Selected:', place);
                triggerSelection(place);
            });
        }).catch(err => console.error('[Autocomplete] Google Load Error:', err));
    }
  }

  function setupLocalSearch() {
    // Create the custom dropdown
    suggestionsList = document.createElement('ul');
    Object.assign(suggestionsList.style, {
      position: 'absolute',
      zIndex: '2147483647', // Max Z-Index to stay on top of Google
      backgroundColor: 'white',
      border: '1px solid #ddd',
      borderRadius: '0 0 8px 8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      listStyle: 'none',
      padding: '0',
      margin: '0',
      width: '100%',
      maxHeight: '300px',
      overflowY: 'auto',
      display: 'none',
      fontSize: '14px',
      fontFamily: 'inherit'
    });
    
    document.body.appendChild(suggestionsList);

    // Event Listeners
    node.addEventListener('input', handleInput);
    node.addEventListener('focus', handleInput); // Show on click too
    
    // Hide when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target !== node && e.target !== suggestionsList && !suggestionsList?.contains(e.target as Node)) {
            if(suggestionsList) suggestionsList.style.display = 'none';
        }
    });

    console.log('[Autocomplete] Local search listeners attached.');
  }

  function handleInput() {
    const query = node.value;
    console.log('[Autocomplete] Typing:', query); // Debug log

    // Reposition the list (in case window resized or scrolled)
    if (suggestionsList) {
      const rect = node.getBoundingClientRect();
      Object.assign(suggestionsList.style, {
        top: `${rect.bottom + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`
      });
    }

    if (!query || query.length < 2) {
      if(suggestionsList) suggestionsList.style.display = 'none';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        console.log('[Autocomplete] Fetching from KV:', query);
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        console.log('[Autocomplete] KV Results:', results);
        renderSuggestions(results);
      } catch (err) {
        console.error('[Autocomplete] Fetch error', err);
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

    // Header
    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '6px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: '#666',
        backgroundColor: '#f8f9fa',
        borderBottom: '1px solid #eee',
        letterSpacing: '0.5px'
    });
    header.textContent = 'SAVED PLACES (Cloudflare KV)';
    suggestionsList.appendChild(header);

    // Items
    items.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.2em;">🍌</span> 
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight: 500; color:#333;">${item.formatted_address || item.name}</span>
            <span style="font-size: 0.8em; color:#888;">Previously visited</span>
          </div>
        </div>
      `;
      
      Object.assign(li.style, {
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee',
        backgroundColor: 'white',
        transition: 'background 0.1s'
      });
      
      li.addEventListener('mouseenter', () => li.style.backgroundColor = '#fff3cd'); // Banana yellow highlight
      li.addEventListener('mouseleave', () => li.style.backgroundColor = 'white');
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent focus loss
        e.stopPropagation();
        selectLocalItem(item);
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
  }

  function selectLocalItem(item: any) {
    console.log('[Autocomplete] Selected Local Item:', item);
    const text = item.formatted_address || item.name;
    
    // Create a mock Google Place object
    const place = {
      formatted_address: text,
      name: text,
      geometry: item.geometry || undefined
    };
    
    triggerSelection(place);
  }

  function triggerSelection(place: any) {
    if(suggestionsList) suggestionsList.style.display = 'none';
    node.value = place.formatted_address || place.name;
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