import type { Action } from "svelte/action";

let googleLoaded = false;
let mapsLoadingPromise: Promise<void> | null = null;

// Helper to load the API script (Does not create a visual map)
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
    // We only need the 'places' library for the search inputs
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
 * Optimized Autocomplete Action
 * 1. Checks Local KV first.
 * 2. Only calls Google Service if Local returns empty.
 * 3. Caches Google selections to Local KV.
 */
export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;
  
  // Google Services (Lazy initialized)
  let autocompleteService: google.maps.places.AutocompleteService | null = null;
  let placesService: google.maps.places.PlacesService | null = null;
  let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

  function initUI() {
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

    // Event: Input typing
    node.addEventListener('input', handleInput);
    
    // Event: Focus (Lazy Load Google Script)
    node.addEventListener('focus', async () => {
        if (params?.apiKey) {
            await loadGoogle(params.apiKey);
            
            // Initialize services if they don't exist yet
            if (!autocompleteService && google.maps && google.maps.places) {
                autocompleteService = new google.maps.places.AutocompleteService();
                sessionToken = new google.maps.places.AutocompleteSessionToken();
                // PlacesService requires a node (even a dummy one) to fetch details
                placesService = new google.maps.places.PlacesService(document.createElement('div'));
            }
        }
        // Trigger search if field already has text
        if (node.value.length > 1) handleInput();
    });

    // Event: Blur (Hide list)
    node.addEventListener('blur', () => {
      setTimeout(() => {
        if(suggestionsList) suggestionsList.style.display = 'none';
      }, 200);
    });
  }

  function handleInput() {
    const query = node.value;
    
    // Update List Position
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
        // --- STEP 1: STRICT LOCAL CHECK ---
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const localResults = await res.json();

        if (localResults && localResults.length > 0) {
           console.log('Found in Local KV:', localResults.length);
           renderSuggestions(localResults, 'local');
           return; // STOP HERE. Do not call Google.
        }

        // --- STEP 2: GOOGLE FALLBACK ---
        if (autocompleteService && sessionToken) {
           console.log('Checking Google API...');
           autocompleteService.getPlacePredictions({
             input: query,
             sessionToken: sessionToken,
             types: ['geocode']
           }, (predictions, status) => {
             if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
               renderSuggestions(predictions, 'google');
             }
           });
        }
      } catch (err) {
        console.error('Autocomplete error', err);
      }
    }, 300);
  }

  function renderSuggestions(items: any[], source: 'local' | 'google') {
    if (!suggestionsList) return;
    
    suggestionsList.innerHTML = '';
    if (!items || items.length === 0) {
      suggestionsList.style.display = 'none';
      return;
    }

    // Header to show user source
    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '4px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: source === 'local' ? '#2e7d32' : '#666',
        backgroundColor: source === 'local' ? '#e8f5e9' : '#f8f9fa',
        borderBottom: '1px solid #eee'
    });
    header.textContent = source === 'local' ? 'SAVED PLACES' : 'GOOGLE SUGGESTIONS';
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      // Google uses 'description', our local DB uses 'formatted_address' or 'name'
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
    // Local items already have geometry/details
    const place = {
      formatted_address: item.formatted_address || item.name,
      name: item.name,
      geometry: item.geometry
    };
    triggerSelection(place);
  }

  function selectGoogleItem(prediction: google.maps.places.AutocompletePrediction) {
    if (!placesService || !sessionToken) return;

    // We must fetch details to get the Lat/Lng for routing
    placesService.getDetails({
        placeId: prediction.place_id,
        fields: ['formatted_address', 'name', 'geometry'], 
        sessionToken: sessionToken
    }, (place, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            // 1. Update UI
            triggerSelection(place);
            
            // 2. CACHE THIS IMMEDIATELY
            fetch('/api/places/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(place)
            }).catch(e => console.error('Failed to cache place', e));

            // 3. Refresh Session Token
            sessionToken = new google.maps.places.AutocompleteSessionToken();
        }
    });
  }

  function triggerSelection(place: any) {
    if(suggestionsList) suggestionsList.style.display = 'none';
    node.value = place.formatted_address || place.name;
    node.dispatchEvent(new CustomEvent('place-selected', { detail: place }));
  }

  initUI();

  return {
    destroy() {
      if (suggestionsList) suggestionsList.remove();
      node.removeEventListener('input', handleInput);
    }
  };
};