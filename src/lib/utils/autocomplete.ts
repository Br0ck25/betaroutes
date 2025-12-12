// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

// Global flag to track if Google Maps is loaded
let googleMapsLoaded = false;
let googleMapsLoading = false;
let googleMapsError = false;
const loadPromises: Array<(value: void) => void> = [];

async function loadGoogleMaps(apiKey: string): Promise<void> {
  if (googleMapsLoaded && typeof google !== 'undefined') return Promise.resolve();
  if (googleMapsError) return Promise.reject(new Error('Google Maps previously failed'));
  if (googleMapsLoading) return new Promise((resolve) => loadPromises.push(resolve));
  
  if (!apiKey || apiKey === 'undefined') {
    googleMapsError = true;
    return Promise.reject(new Error('No API key'));
  }
  
  googleMapsLoading = true;
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      googleMapsLoaded = true;
      googleMapsLoading = false;
      resolve();
      loadPromises.forEach(r => r());
      loadPromises.length = 0;
    };
    
    script.onerror = (error) => {
      googleMapsLoading = false;
      googleMapsError = true;
      reject(new Error('Failed to load Google Maps'));
      loadPromises.length = 0;
    };
    
    document.head.appendChild(script);
  });
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let dropdown: HTMLDivElement | null = null;
  let debounceTimer: any;
  let isSelecting = false;
  
  // [!code ++] Session Token & Service State
  let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;
  let placesService: google.maps.places.PlacesService | null = null;
  
  if (params.apiKey && params.apiKey !== 'undefined') {
    loadGoogleMaps(params.apiKey)
        .then(() => initServices())
        .catch(console.error);
  }
  
  // [!code ++] Initialize Services
  function initServices() {
      if (typeof google !== 'undefined' && google.maps && google.maps.places) {
          sessionToken = new google.maps.places.AutocompleteSessionToken();
          // PlacesService requires a container, even if dummy
          placesService = new google.maps.places.PlacesService(document.createElement('div'));
      }
  }
  
  function initUI() {
    dropdown = document.createElement('div');
    dropdown.className = 'pac-container';
    
    // GOOGLE MATERIAL DESIGN STYLING (Restored)
    Object.assign(dropdown.style, {
      position: 'absolute',
      zIndex: '9999',
      backgroundColor: '#fff',
      borderTop: '1px solid #e6e6e6',
      fontFamily: '"Roboto", "Arial", sans-serif',
      boxShadow: '0 4px 6px rgba(32, 33, 36, 0.28)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'none',
      borderRadius: '0 0 8px 8px',
      marginTop: '-2px', // Slight overlap with input
      paddingBottom: '8px'
    });
    
    document.body.appendChild(dropdown);
  }

  function updatePosition() {
    if (!dropdown) return;
    const rect = node.getBoundingClientRect();
    Object.assign(dropdown.style, {
      top: `${rect.bottom + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`
    });
  }

  async function handleInput(e: Event) {
    if (isSelecting) {
      isSelecting = false;
      return;
    }
    
    const value = (e.target as HTMLInputElement).value;
    updatePosition();
    
    if (!value || value.length < 2) {
      if (dropdown) dropdown.style.display = 'none';
      return;
    }
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const startTime = performance.now();
        
        // 1. Try KV Cache
        const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        const kvRes = await fetch(kvUrl);
        const kvData = await kvRes.json();
        const kvTime = Math.round(performance.now() - startTime);

        // Normalize KV data
        const validKvData = Array.isArray(kvData) ? kvData.map((item: any) => {
            // Handle potentially double-stringified JSON
            if (typeof item === 'string') {
                try { return JSON.parse(item); } catch { return null; }
            }
            return item;
        }).filter(item => item && (item.formatted_address || item.name)) : [];
        
        if (validKvData.length > 0) {
          renderResults(validKvData.slice(0, 5), 'kv', kvTime);
        } else {
          // 2. Fallback to Google
          await fetchGooglePlaces(value, startTime);
        }
      } catch (err) {
        renderError();
      }
    }, 300);
  }
  
  async function fetchGooglePlaces(input: string, startTime: number) {
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
      renderEmpty();
      return;
    }
    
    try {
      const service = new google.maps.places.AutocompleteService();
      
      // [!code ++] Ensure token exists
      if (!sessionToken) sessionToken = new google.maps.places.AutocompleteSessionToken();

      service.getPlacePredictions(
        { 
            input, 
            sessionToken: sessionToken, // [!code ++] Pass Session Token
            componentRestrictions: { country: 'us' } 
        },
        (predictions, status) => {
          const googleTime = Math.round(performance.now() - startTime);
          
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            const results = predictions.map(p => ({
              formatted_address: p.description,
              name: p.structured_formatting?.main_text || p.description,
              secondary_text: p.structured_formatting?.secondary_text,
              place_id: p.place_id // Important for getDetails
            }));
            
            renderResults(results, 'google', googleTime);
            // Don't cache session-based results directly if they depend on the token context, 
            // but for simple text caching it's usually okay.
            cacheToKV(input, results);
          } else {
            renderEmpty();
          }
        }
      );
    } catch {
      renderError();
    }
  }
  
  async function cacheToKV(query: string, results: any[]) {
    try {
      fetch('/api/autocomplete/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, results })
      });
    } catch (e) { /* silent fail */ }
  }
  
  function renderResults(items: any[], source: 'kv' | 'google' = 'kv', timing?: number) {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    // --- Header Section ---
    const header = document.createElement('div');
    const sourceLabel = source === 'kv' ? '⚡ Fast Cache' : '🌐 Google Live';
    const sourceColor = source === 'kv' ? '#10B981' : '#4285F4';
    
    header.innerHTML = `
      <span style="color: ${sourceColor}; font-weight: 500;">${sourceLabel}</span>
      ${timing ? `<span style="color: #9AA0A6; font-size: 11px;">${timing}ms</span>` : ''}
    `;
    
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 16px',
      borderBottom: '1px solid #f1f3f4',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      backgroundColor: '#f8f9fa'
    });
    dropdown.appendChild(header);
    
    // --- Result Items ---
    items.forEach((item) => {
      const row = document.createElement('div');
      
      const mainText = item.name || item.formatted_address.split(',')[0];
      const secondaryText = item.secondary_text || 
                            (item.formatted_address.includes(',') 
                             ? item.formatted_address.split(',').slice(1).join(',').trim() 
                             : '');

      // Material Design Pin Icon
      const pinIcon = `
        <svg focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9AA0A6" width="20px" height="20px">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      `;

      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid #fff' // invisible border for spacing
      });
      
      row.innerHTML = `
        <div style="min-width: 24px; margin-right: 12px; display: flex; align-items: center;">${pinIcon}</div>
        <div style="flex: 1; overflow: hidden;">
          <div style="font-size: 14px; color: #202124; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${mainText}
          </div>
          <div style="font-size: 12px; color: #70757A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">
            ${secondaryText}
          </div>
        </div>
      `;
      
      // Hover effects
      row.addEventListener('mouseenter', () => {
        row.style.backgroundColor = '#e8f0fe';
      });
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = '#fff';
      });
      
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // [!code ++] Pass item source to selectItem to determine if we need details fetch
        selectItem(item, source);
      });
      
      dropdown!.appendChild(row);
    });
    
    // --- Google Logo Footer (Required by ToS) ---
    if (source === 'google') {
       const footer = document.createElement('div');
       Object.assign(footer.style, {
         textAlign: 'right',
         padding: '4px 16px',
       });
       footer.innerHTML = '<img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" style="height: 12px; opacity: 0.7;">';
       dropdown.appendChild(footer);
    }
    
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderEmpty() {
    if (!dropdown) return;
    dropdown.innerHTML = `
      <div style="padding: 16px; color: #70757A; font-size: 13px; text-align: center;">
        No results found
      </div>
    `;
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderError() { /* same as empty but red text if desired */ }
  
  // [!code ++] Fetches full details to close the session and get precise data
  function selectItem(item: any, source: 'kv' | 'google') {
    if (dropdown) dropdown.style.display = 'none';
    isSelecting = true;

    // If it's a Google result, we MUST call getDetails with the session token 
    // to consolidate billing and get the proper formatted address/geometry.
    if (source === 'google' && item.place_id && placesService && sessionToken) {
        const request = {
            placeId: item.place_id,
            fields: ['name', 'formatted_address', 'geometry'],
            sessionToken: sessionToken
        };

        placesService.getDetails(request, (place, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && place) {
                commitSelection({
                    formatted_address: place.formatted_address || item.formatted_address,
                    name: place.name || item.name,
                    geometry: place.geometry
                });
                // Generate new token for next interaction
                sessionToken = new google.maps.places.AutocompleteSessionToken();
            } else {
                // Fallback if details fail
                commitSelection(item);
            }
        });
    } else {
        // KV result or no service available - use what we have
        commitSelection(item);
    }
  }

  function commitSelection(data: any) {
    node.value = data.formatted_address || data.name;
    
    // Critical: Dispatch input event so Svelte bind:value updates
    node.dispatchEvent(new Event('input', { bubbles: true }));
    
    node.dispatchEvent(new CustomEvent('place-selected', { 
      detail: data
    }));
  }
  
  initUI();
  initServices(); // Try initializing immediately in case Google is already loaded

  node.addEventListener('input', handleInput);
  node.addEventListener('focus', () => {
    if (node.value.length > 1) {
      const inputEvent = new Event('input', { bubbles: true });
      Object.defineProperty(inputEvent, 'target', { value: node, enumerable: true });
      handleInput(inputEvent);
    }
  });
  node.addEventListener('blur', () => setTimeout(() => { if (dropdown) dropdown.style.display = 'none'; }, 200));
  
  window.addEventListener('scroll', updatePosition);
  window.addEventListener('resize', updatePosition);
  
  return {
    destroy() {
      if (dropdown) dropdown.remove();
      node.removeEventListener('input', handleInput);
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    }
  };
};