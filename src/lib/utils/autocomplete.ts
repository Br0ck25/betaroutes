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
    // Ensure 'places' library is requested
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
 * 1. Lazy loads Google Maps on interaction (focus)
 * 2. Checks BETA_PLACES_KV via API first
 * 3. Falls back to Google Maps AutocompleteService (using Session Tokens)
 * 4. Caches Google results locally on selection
 */
export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;
  
  // Google Services
  let autocompleteService: google.maps.places.AutocompleteService | null = null;
  let placesService: google.maps.places.PlacesService | null = null;
  let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

  async function ensureGoogleServices() {
    if (!params?.apiKey) return;
    await loadGoogle(params.apiKey);
    
    if (!autocompleteService && googleLoaded) {
      autocompleteService = new google.maps.places.AutocompleteService();
      sessionToken = new google.maps.places.AutocompleteSessionToken();
      // PlacesService requires a node, even if dummy
      placesService = new google.maps.places.PlacesService(document.createElement('div'));
    }
  }

  function setupUI() {
    // Create the custom dropdown element
    suggestionsList = document.createElement('ul');
    Object.assign(suggestionsList.style, {
      position: 'absolute',
      zIndex: '2147483647',
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
    
    // Lazy load Google on focus
    node.addEventListener('focus', () => {
      ensureGoogleServices();
      handleInput(); // Re-trigger search if field has value
    });

    node.addEventListener('blur', () => {
      setTimeout(() => {
        if(suggestionsList) suggestionsList.style.display = 'none';
      }, 200);
    });
  }

  function handleInput() {
    const query = node.value;
    
    // Update Position
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
        // 1. Try Local First
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const localResults = await res.json();

        // If we have local results, show them and STOP (save API call)
        if (localResults && localResults.length > 0) {
           renderSuggestions(localResults, 'local');
           return;
        }

        // 2. Fallback to Google if initialized
        if (autocompleteService && sessionToken) {
           autocompleteService.getPlacePredictions({
             input: query,
             sessionToken: sessionToken,
             types: ['geocode'] // optimize for addresses
           }, (predictions, status) => {
             if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
               renderSuggestions(predictions, 'google');
             }
           });
        }
      } catch (err) {
        console.error('Autocomplete error', err);
      }
    }, 300); // Increased debounce slightly to 300ms
  }

  function renderSuggestions(items: any[], source: 'local' | 'google') {
    if (!suggestionsList) return;
    
    suggestionsList.innerHTML = '';
    if (!items || items.length === 0) {
      suggestionsList.style.display = 'none';
      return;
    }

    // Optional Header
    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '4px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: source === 'local' ? '#2e7d32' : '#666',
        backgroundColor: source === 'local' ? '#e8f5e9' : '#f8f9fa',
        borderBottom: '1px solid #eee'
    });
    header.textContent = source === 'local' ? 'SAVED PLACES (Offline Ready)' : 'GOOGLE SUGGESTIONS';
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      // Google predictions use 'description', local uses 'formatted_address' or 'name'
      const text = source === 'google' ? item.description : (item.formatted_address || item.name);
      
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.2em;">${source === 'local' ? '📍' : '🔎'}</span> 
          <span style="font-weight: 500;">${text}</span>
        </div>
      `;
      
      Object.assign(li.style, {
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee',
        color: '#333',
        transition: 'background 0.1s'
      });
      
      li.addEventListener('mouseenter', () => li.style.backgroundColor = '#f0f0f0');
      li.addEventListener('mouseleave', () => li.style.backgroundColor = 'white');
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        if (source === 'local') {
            selectLocalItem(item);
        } else {
            selectGoogleItem(item);
        }
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
  }

  function selectLocalItem(item: any) {
    const text = item.formatted_address || item.name;
    const place = {
      formatted_address: text,
      name: text,
      geometry: item.geometry || undefined
    };
    triggerSelection(place);
  }

  function selectGoogleItem(prediction: google.maps.places.AutocompletePrediction) {
    if (!placesService || !sessionToken) return;

    // Fetch Details (charges for Place Details, but we save it immediately)
    placesService.getDetails({
        placeId: prediction.place_id,
        fields: ['formatted_address', 'name', 'geometry'], // Fetch geometry for the map
        sessionToken: sessionToken
    }, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            // 1. Update UI
            triggerSelection(place);
            
            // 2. Cache this result to our KV!
            fetch('/api/places/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(place)
            }).catch(e => console.error('Failed to cache place', e));

            // 3. Reset Session Token
            sessionToken = new google.maps.places.AutocompleteSessionToken();
        }
    });
  }

  function triggerSelection(place: any) {
    if(suggestionsList) suggestionsList.style.display = 'none';
    
    // Update input value
    node.value = place.formatted_address || place.name;
    
    // Dispatch event
    node.dispatchEvent(new CustomEvent('place-selected', { detail: place }));
  }

  setupUI();

  return {
    destroy() {
      if (suggestionsList) suggestionsList.remove();
      node.removeEventListener('input', handleInput);
    }
  };
};