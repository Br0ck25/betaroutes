// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

// Singleton Promise to prevent race conditions
let loadingPromise: Promise<void> | null = null;
let googleMapsError = false;

// Exported Singleton Loader
export async function loadGoogleMaps(apiKey: string): Promise<void> {
  // 1. Check if fully loaded
  if (typeof google !== 'undefined' && google.maps) return Promise.resolve();
  
  // 2. Check if previously failed
  if (googleMapsError) return Promise.reject(new Error('Google Maps previously failed'));
  
  // 3. Check if currently loading (return existing promise)
  if (loadingPromise) return loadingPromise;
  
  // 4. Validation
  if (!apiKey || apiKey === 'undefined') {
    googleMapsError = true;
    return Promise.reject(new Error('No API key'));
  }

  // 5. Check DOM for existing script (Edge case: injected by another source)
  const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
  if (existingScript) {
      loadingPromise = new Promise((resolve) => {
          const check = setInterval(() => {
              if (typeof google !== 'undefined' && google.maps) {
                  clearInterval(check);
                  resolve();
              }
          }, 100);
      });
      return loadingPromise;
  }
  
  // 6. Start New Load
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // [!code change] Added 'geometry' to libraries to ensure full compatibility
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      resolve();
    };
    
    script.onerror = (error) => {
      googleMapsError = true;
      loadingPromise = null;
      reject(new Error('Failed to load Google Maps'));
    };
    
    document.head.appendChild(script);
  });

  return loadingPromise;
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let dropdown: HTMLDivElement | null = null;
  let debounceTimer: any;
  let isSelecting = false;
  
  // Session Token & Service State
  let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;
  let placesService: google.maps.places.PlacesService | null = null;
  
  if (params.apiKey && params.apiKey !== 'undefined') {
    loadGoogleMaps(params.apiKey)
        .then(() => initServices())
        .catch(console.error);
  }
  
  function initServices() {
      if (typeof google !== 'undefined' && google.maps && google.maps.places) {
          sessionToken = new google.maps.places.AutocompleteSessionToken();
          placesService = new google.maps.places.PlacesService(document.createElement('div'));
      }
  }
  
  function initUI() {
    dropdown = document.createElement('div');
    dropdown.className = 'pac-container';
    
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
      marginTop: '-2px',
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

        const validKvData = Array.isArray(kvData) ? kvData.map((item: any) => {
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
      if (!sessionToken) sessionToken = new google.maps.places.AutocompleteSessionToken();

      service.getPlacePredictions(
        { 
            input, 
            sessionToken: sessionToken,
            componentRestrictions: { country: 'us' } 
        },
        (predictions, status) => {
          const googleTime = Math.round(performance.now() - startTime);
          
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            const results = predictions.map(p => ({
              formatted_address: p.description,
              name: p.structured_formatting?.main_text || p.description,
              secondary_text: p.structured_formatting?.secondary_text,
              place_id: p.place_id
            }));
            
            renderResults(results, 'google', googleTime);
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
    
    items.forEach((item) => {
      const row = document.createElement('div');
      
      const mainText = item.name || item.formatted_address.split(',')[0];
      const secondaryText = item.secondary_text || 
                            (item.formatted_address.includes(',') 
                             ? item.formatted_address.split(',').slice(1).join(',').trim() 
                             : '');

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
        borderBottom: '1px solid #fff'
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
      
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = '#e8f0fe'; });
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = '#fff'; });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item, source);
      });
      
      dropdown!.appendChild(row);
    });
    
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
  
  function renderError() { /* ... */ }
  
  function selectItem(item: any, source: 'kv' | 'google') {
    if (dropdown) dropdown.style.display = 'none';
    isSelecting = true;

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
                sessionToken = new google.maps.places.AutocompleteSessionToken();
            } else {
                commitSelection(item);
            }
        });
    } else {
        commitSelection(item);
    }
  }

  function commitSelection(data: any) {
    node.value = data.formatted_address || data.name;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new CustomEvent('place-selected', { detail: data }));
  }
  
  initUI();
  initServices();

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