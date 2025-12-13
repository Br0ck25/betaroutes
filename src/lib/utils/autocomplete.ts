// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

// Singleton Promise to prevent race conditions
let loadingPromise: Promise<void> | null = null;
let googleMapsError = false;

// Exported Singleton Loader
export async function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof google !== 'undefined' && google.maps) return Promise.resolve();
  if (googleMapsError) return Promise.reject(new Error('Google Maps previously failed'));
  if (loadingPromise) return loadingPromise;
  
  if (!apiKey || apiKey === 'undefined') {
    googleMapsError = true;
    return Promise.reject(new Error('No API key'));
  }

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
  
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Note: We still load 'places' lib for types, but we won't call AutocompleteService
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => resolve();
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
  
  if (params.apiKey && params.apiKey !== 'undefined') {
    loadGoogleMaps(params.apiKey).catch(console.error);
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
        
        // [!code changed] Always fetch from our API (Proxies to Google if needed)
        const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        const kvRes = await fetch(kvUrl);
        const data = await kvRes.json();
        const time = Math.round(performance.now() - startTime);

        const validData = Array.isArray(data) ? data : [];
        
        if (validData.length > 0) {
          // Identify source based on data properties (KV usually has full geometry cached)
          const source = validData[0].source === 'google_proxy' ? 'google' : 'kv';
          renderResults(validData.slice(0, 5), source, time);
        } else {
          renderEmpty();
        }
      } catch (err) {
        renderError();
      }
    }, 300);
  }
  
  // [!code removed] fetchGooglePlaces() removed entirely
  
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

      const pinIcon = `<svg focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#9AA0A6" width="20px" height="20px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

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
          <div style="font-size: 14px; color: #202124; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${mainText}</div>
          <div style="font-size: 12px; color: #70757A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">${secondaryText}</div>
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
       Object.assign(footer.style, { textAlign: 'right', padding: '4px 16px' });
       footer.innerHTML = '<img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" style="height: 12px; opacity: 0.7;">';
       dropdown.appendChild(footer);
    }
    
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderEmpty() {
    if (!dropdown) return;
    dropdown.innerHTML = `<div style="padding: 16px; color: #70757A; font-size: 13px; text-align: center;">No results found</div>`;
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderError() { /* ... */ }
  
  async function selectItem(item: any, source: 'kv' | 'google') {
    if (dropdown) dropdown.style.display = 'none';
    isSelecting = true;

    // Check if we need to fetch details (geometry)
    // If it came from KV cache, it likely has geometry. 
    // If it came from Google Proxy, it definitely DOES NOT have geometry yet.
    if (!item.geometry || !item.geometry.location) {
        if (item.place_id) {
            try {
                // [!code changed] Proxy 'Get Details' through our API
                const res = await fetch(`/api/autocomplete?placeid=${item.place_id}`);
                const details = await res.json();
                
                if (details && details.geometry) {
                    const fullItem = {
                        ...item,
                        formatted_address: details.formatted_address || item.formatted_address,
                        name: details.name || item.name,
                        geometry: details.geometry
                    };
                    commitSelection(fullItem);
                    // Optionally update cache here with full details
                    return;
                }
            } catch(e) {
                console.error("Details fetch failed", e);
            }
        }
        // Fallback: commit what we have (might miss Lat/Lng)
        commitSelection(item);
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