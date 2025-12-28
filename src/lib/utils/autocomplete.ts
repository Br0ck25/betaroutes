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
    // Use Google's recommended loading pattern to avoid the "loaded directly without loading=async" warning
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&loading=async`;
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
  // Event handlers for dropdown - declared here so cleanup can access the same references
  let stop: (e: Event) => void;
  let stopAndPrevent: (e: Event) => void;
  
  if (params.apiKey && params.apiKey !== 'undefined') {
    loadGoogleMaps(params.apiKey).catch(console.error);
  }
  
  // Prefer appending the dropdown to the nearest <dialog> (modal) when present.
  // This prevents native dialog backdrops from intercepting clicks on the dropdown.
  function initUI() {
    dropdown = document.createElement('div');
    dropdown.className = 'pac-container';

    Object.assign(dropdown.style, {
      position: 'absolute', // may be changed to 'fixed' when appended to <body>
      zIndex: '2147483647',
      backgroundColor: '#fff',
      borderTop: '1px solid #e6e6e6',
      fontFamily: '"Roboto", "Arial", sans-serif',
      boxShadow: '0 4px 6px rgba(32, 33, 36, 0.28)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'none',
      borderRadius: '0 0 8px 8px',
      marginTop: '-2px',
      paddingBottom: '8px',
      pointerEvents: 'auto'
    });

    // If the input is inside a native <dialog>, append the dropdown to that dialog
    // so it sits above the backdrop and is selectable. Otherwise append to document.body
    const dialogAncestor = node.closest && node.closest('dialog');
    if (dialogAncestor) {
      (dropdown as any).__autocompleteContainer = dialogAncestor; // store ref for cleanup
      dialogAncestor.appendChild(dropdown);
      // Keep position absolute (relative to the dialog)
      dropdown.style.position = 'absolute';
    } else {
      document.body.appendChild(dropdown);
      // Use fixed positioning when attached to body so it stays aligned to viewport
      dropdown.style.position = 'fixed';
    }

    // Prevent clicks inside the dropdown from bubbling up to the <dialog> backdrop or other parent handlers
    stop = (e: Event) => { e.stopPropagation(); };
    stopAndPrevent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };

    dropdown.addEventListener('pointerdown', stopAndPrevent);
    dropdown.addEventListener('pointerup', stop);
    dropdown.addEventListener('mousedown', stopAndPrevent);
    dropdown.addEventListener('mouseup', stop);
    dropdown.addEventListener('touchstart', stopAndPrevent);
    dropdown.addEventListener('touchend', stop);
    dropdown.addEventListener('click', stop);
  }

  function updatePosition() {
    if (!dropdown) return;
    const rect = node.getBoundingClientRect();

    if ((dropdown as any).__autocompleteContainer && (dropdown as any).__autocompleteContainer instanceof Element) {
      // Dropdown is inside a dialog; compute position relative to that dialog
      const parentRect = ((dropdown as any).__autocompleteContainer as Element).getBoundingClientRect();
      Object.assign(dropdown.style, {
        top: `${rect.bottom - parentRect.top}px`,
        left: `${rect.left - parentRect.left}px`,
        width: `${rect.width}px`
      });
    } else {
      // Dropdown is attached to body (fixed positioning)
      Object.assign(dropdown.style, {
        top: `${rect.bottom}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`
      });
    }
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
        
        // Always fetch from our API (Proxies to Photon/Google if needed)
        const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        const kvRes = await fetch(kvUrl);
        const data = await kvRes.json();
        const time = Math.round(performance.now() - startTime);

        const validData = Array.isArray(data) ? data : [];
        
        if (validData.length > 0) {
          // Identify source based on data properties
          // 'google_proxy' and 'photon' are set by the server
          let source: 'kv' | 'google' | 'photon' = 'kv';
          if (validData[0].source === 'google_proxy') source = 'google';
          if (validData[0].source === 'photon') source = 'photon';

          // If results came from external APIs (Google/Photon), cache them for next time
          if (source !== 'kv') {
             // Remove the 'source' tag so the cache sees them as clean KV objects next time
             const cleanResults = validData.map(({ source, ...rest }) => rest);
             cacheToKV(value, cleanResults);
          }

          renderResults(validData.slice(0, 5), source, time);
        } else {
          renderEmpty();
        }
      } catch (err) {
        renderError();
      }
    }, 300);
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

  // Save a fully selected place (with geometry) to KV
  async function savePlaceToKV(place: any) {
    try {
      // [!code fix] Changed from '/api/autocomplete' to '/api/places/cache' to match server handler
      fetch('/api/places/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(place)
      });
    } catch (e) { console.error('Failed to save place details', e); }
  }
  
  function renderResults(items: any[], source: 'kv' | 'google' | 'photon' = 'kv', timing?: number) {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    const header = document.createElement('div');
    
    let sourceLabel = '⚡ Fast Cache';
    let sourceColor = '#10B981'; // Green

    if (source === 'google') {
        sourceLabel = '🌐 Google Live';
        sourceColor = '#4285F4'; // Blue
    } else if (source === 'photon') {
        sourceLabel = '🌍 OpenMap';
        sourceColor = '#F59E0B'; // Orange/Amber
    }
    
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
      // Use pointerdown and stop propagation to avoid dialog/backdrop clicks closing the modal
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
  
  async function selectItem(item: any, source: 'kv' | 'google' | 'photon') {
    if (dropdown) dropdown.style.display = 'none';
    isSelecting = true;

    // Check if we need to fetch details (geometry)
    // Photon and KV usually have geometry. Google Proxy usually does not.
    if (!item.geometry || !item.geometry.location) {
        if (item.place_id && source === 'google') {
            try {
                // Proxy 'Get Details' through our API
                const res = await fetch(`/api/autocomplete?placeid=${item.place_id}`);
                const details = await res.json();
                
                if (details && details.geometry) {
                    const fullItem = {
                        ...item,
                        formatted_address: details.formatted_address || item.formatted_address,
                        name: details.name || item.name,
                        geometry: details.geometry
                    };
                    
                    // Save the FULL item (with geometry) to KV for next time
                    savePlaceToKV(fullItem);
                    
                    commitSelection(fullItem);
                    return;
                }
            } catch(e) {
                console.error("Details fetch failed", e);
            }
        }
        // Fallback: commit what we have (might miss Lat/Lng)
        commitSelection(item);
    } else {
        // If it came from KV or Photon, we likely have geometry already.
        // We ensure we save it to KV so it gets "promoted" from 'photon' source to 'kv' cache
        if (source === 'photon') {
             savePlaceToKV(item);
        }
        commitSelection(item);
    }
  }

  function commitSelection(data: any) {
    node.value = data.formatted_address || data.name;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new CustomEvent('place-selected', { detail: data }));

    // Ensure input regains focus so the modal doesn't get an unexpected focus shift
    setTimeout(() => {
      try { node.focus(); } catch (e) {}
    }, 0);

    // If the input lives inside a <dialog>, temporarily suppress its close handler
    // to avoid races where backdrop click closes it during selection.
    const dlg = node.closest && node.closest('dialog');
    if (dlg) {
      try {
        (dlg as any).__suppressClose = true;
        // Short timeout, long enough to survive the click/close event cycle
        setTimeout(() => { try { (dlg as any).__suppressClose = false; } catch(e) {} }, 500);
        console.debug && console.debug('[autocomplete] commitSelection: set __suppressClose on dialog', { open: (dlg as any).open });
      } catch (e) { /* ignore */ }
    }

    // If it was closed synchronously, try to re-open it
    if (dlg && !(dlg as HTMLDialogElement).open) {
      try { (dlg as HTMLDialogElement).showModal(); } catch(e) { /* ignore */ }
      // re-focus after re-opening
      setTimeout(() => { try { node.focus(); } catch(e) {} }, 60);
    }
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

  // Cleanup helpers (so we can remove the handlers we added above)
  const _removeDropdownHandlers = () => {
    if (!dropdown) return;
    dropdown.removeEventListener('pointerdown', stopAndPrevent as any);
    dropdown.removeEventListener('pointerup', stop as any);
    dropdown.removeEventListener('mousedown', stopAndPrevent as any);
    dropdown.removeEventListener('mouseup', stop as any);
    dropdown.removeEventListener('touchstart', stopAndPrevent as any);
    dropdown.removeEventListener('touchend', stop as any);
    dropdown.removeEventListener('click', stop as any);
  };
  
  window.addEventListener('scroll', updatePosition);
  window.addEventListener('resize', updatePosition);
  
  return {
    destroy() {
      if (dropdown) {
        _removeDropdownHandlers();
        dropdown.remove();
      }
      node.removeEventListener('input', handleInput);
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    }
  };
};