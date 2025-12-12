// src/lib/utils/autocomplete.ts - Google Places Style with fallback
import type { Action } from "svelte/action";

// Global flag to track if Google Maps is loaded
let googleMapsLoaded = false;
let googleMapsLoading = false;
const loadPromises: Array<(value: void) => void> = [];

async function loadGoogleMaps(apiKey: string): Promise<void> {
  // Already loaded
  if (googleMapsLoaded && typeof google !== 'undefined') {
    return Promise.resolve();
  }
  
  // Currently loading, wait for it
  if (googleMapsLoading) {
    return new Promise((resolve) => {
      loadPromises.push(resolve);
    });
  }
  
  // Start loading
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
      // Resolve all waiting promises
      loadPromises.forEach(r => r());
      loadPromises.length = 0;
    };
    
    script.onerror = () => {
      googleMapsLoading = false;
      reject(new Error('Failed to load Google Maps'));
    };
    
    document.head.appendChild(script);
  });
}

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let dropdown: HTMLDivElement | null = null;
  let debounceTimer: any;
  let isSelecting = false; // Flag to prevent reopening after selection
  
  // Load Google Maps script
  if (params.apiKey) {
    loadGoogleMaps(params.apiKey).catch(err => {
      console.error('[Autocomplete] Failed to load Google Maps:', err);
    });
  }
  
  function initUI() {
    dropdown = document.createElement('div');
    dropdown.className = 'pac-container pac-logo';
    
    // Google Places exact styling
    Object.assign(dropdown.style, {
      position: 'absolute',
      zIndex: '1000',
      backgroundColor: '#fff',
      border: '0',
      borderTop: '1px solid #d9d9d9',
      fontFamily: 'Roboto, Arial, sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'none',
      borderRadius: '0 0 2px 2px'
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
    // Don't reopen dropdown if we just selected something
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
        
        // First try KV database
        console.log(`🔍 [AUTOCOMPLETE] Searching for: "${value}"`);
        const kvUrl = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        const kvRes = await fetch(kvUrl);
        let kvData = await kvRes.json();
        const kvTime = Math.round(performance.now() - startTime);
        
        // Handle case where API returns strings instead of objects
        if (Array.isArray(kvData) && kvData.length > 0 && typeof kvData[0] === 'string') {
          console.log('[AUTOCOMPLETE] Parsing JSON strings from API');
          kvData = kvData.map((item: any) => {
            try {
              return typeof item === 'string' ? JSON.parse(item) : item;
            } catch (err) {
              console.error('[AUTOCOMPLETE] Failed to parse:', item);
              return null;
            }
          }).filter(Boolean);
        }
        
        if (kvData && kvData.length > 0) {
          // Validate data before rendering
          console.log(`✅ [AUTOCOMPLETE] KV Cache HIT - ${kvData.length} results in ${kvTime}ms`);
          
          // Deep inspection of first item
          if (kvData[0]) {
            const firstItem = kvData[0];
            console.log('[AUTOCOMPLETE] First item inspection:');
            console.log('  - typeof:', typeof firstItem);
            console.log('  - keys:', Object.keys(firstItem));
            console.log('  - formatted_address:', firstItem.formatted_address);
            console.log('  - name:', firstItem.name);
            console.log('  - Full item:', firstItem);
          }
          
          // Filter out invalid entries
          const validData = kvData.filter((item: any) => {
            const address = item?.formatted_address || item?.name || item?.description;
            const isValid = Boolean(address && typeof address === 'string' && address.trim().length > 0);
            
            if (!isValid) {
              console.warn('[AUTOCOMPLETE] INVALID -', 
                'fa:', item?.formatted_address, 
                'name:', item?.name,
                'desc:', item?.description);
            }
            
            return isValid;
          });
          
          console.log(`[AUTOCOMPLETE] Valid: ${validData.length} / Invalid: ${kvData.length - validData.length}`);
          
          if (validData.length > 0) {
            renderResults(validData, 'kv', kvTime);
          } else {
            console.log('[AUTOCOMPLETE] All KV results invalid, trying Google');
            await fetchGooglePlaces(value, startTime);
          }
        } else {
          console.log(`❌ [AUTOCOMPLETE] KV Cache MISS - Falling back to Google Places`);
          // No KV results, fall back to Google Places
          await fetchGooglePlaces(value, startTime);
        }
      } catch (err) {
        console.error('[AUTOCOMPLETE] Error:', err);
        renderError();
      }
    }, 300);
  }
  
  async function fetchGooglePlaces(input: string, startTime: number) {
    // Check if Google Maps is loaded
    if (typeof google === 'undefined' || !google.maps || !google.maps.places) {
      console.warn('[AUTOCOMPLETE] Google Maps not loaded yet, cannot fetch places');
      renderEmpty();
      return;
    }
    
    try {
      const service = new google.maps.places.AutocompleteService();
      
      service.getPlacePredictions(
        { 
          input,
          componentRestrictions: { country: 'us' }
        },
        (predictions, status) => {
          const googleTime = Math.round(performance.now() - startTime);
          
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            console.log(`🌐 [AUTOCOMPLETE] Google Places API - ${predictions.length} results in ${googleTime}ms`);
            const results = predictions.map(p => ({
              formatted_address: p.description,
              name: p.structured_formatting?.main_text || p.description,
              place_id: p.place_id
            }));
            renderResults(results, 'google', googleTime);
            
            // Cache these results to KV for future use
            cacheToKV(input, results);
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            console.log(`🌐 [AUTOCOMPLETE] Google Places - No results found`);
            renderEmpty();
          } else {
            console.error('[AUTOCOMPLETE] Google Places error:', status);
            renderError();
          }
        }
      );
    } catch (err) {
      console.error('[AUTOCOMPLETE] Google Places error:', err);
      renderError();
    }
  }
  
  async function cacheToKV(query: string, results: any[]) {
    try {
      console.log(`💾 [AUTOCOMPLETE] Caching ${results.length} results to KV...`);
      // Send results to API endpoint to cache in KV
      const response = await fetch('/api/autocomplete/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, results })
      });
      const data = await response.json();
      if (data.cached) {
        console.log(`✅ [AUTOCOMPLETE] Cached ${data.count} addresses to KV`);
      }
    } catch (err) {
      console.warn('⚠️ [AUTOCOMPLETE] Failed to cache to KV:', err);
    }
  }
  
  function renderResults(items: any[], source: 'kv' | 'google' = 'kv', timing?: number) {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    // Add source indicator header
    const header = document.createElement('div');
    header.className = 'pac-source-header';
    const sourceIcon = source === 'kv' ? '⚡' : '🌐';
    const sourceLabel = source === 'kv' ? 'KV Cache' : 'Google Places';
    const sourceColor = source === 'kv' ? '#10B981' : '#3B82F6';
    header.innerHTML = `
      <span style="color: ${sourceColor}; font-weight: 600;">${sourceIcon} ${sourceLabel}</span>
      ${timing ? `<span style="color: #9CA3AF; font-size: 12px;">${timing}ms</span>` : ''}
    `;
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      backgroundColor: '#F9FAFB',
      borderBottom: '1px solid #E5E7EB',
      fontSize: '13px'
    });
    dropdown.appendChild(header);
    
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'pac-item';
      
      // Safely get text with fallback
      const text = item.formatted_address || item.name || item.description || 'Unknown Address';
      const parts = text.split(',');
      const mainText = parts[0]?.trim() || text;
      const secondaryText = parts.length > 1 ? parts.slice(1).join(',').trim() : '';
      
      row.innerHTML = `
        <span class="pac-icon pac-icon-marker"></span>
        <span class="pac-item-query">
          <span class="pac-matched">${mainText}</span>
        </span>
        ${secondaryText ? `<span class="pac-item-secondary-text">${secondaryText}</span>` : ''}
      `;
      
      // Google-style hover
      row.addEventListener('mouseenter', () => {
        row.style.backgroundColor = '#fafafa';
        row.style.cursor = 'pointer';
      });
      
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = '#fff';
      });
      
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      
      dropdown!.appendChild(row);
    });
    
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderEmpty() {
    if (!dropdown) return;
    dropdown.innerHTML = `
      <div class="pac-item" style="padding: 12px 16px; color: #999; font-size: 14px;">
        No results found
      </div>
    `;
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function renderError() {
    if (!dropdown) return;
    dropdown.innerHTML = `
      <div class="pac-item" style="padding: 12px 16px; color: #d32f2f; font-size: 14px;">
        Error loading suggestions
      </div>
    `;
    dropdown.style.display = 'block';
    updatePosition();
  }
  
  function selectItem(item: any) {
    if (dropdown) dropdown.style.display = 'none';
    
    // Set flag before changing value to prevent reopening
    isSelecting = true;
    node.value = item.formatted_address || item.name;
    
    // Dispatch input event to update Svelte binding
    node.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Also dispatch custom event for additional handling
    node.dispatchEvent(new CustomEvent('place-selected', { 
      detail: { 
        formatted_address: item.formatted_address,
        name: item.name 
      } 
    }));
  }
  
  // Initialize
  initUI();
  node.addEventListener('input', handleInput);
  node.addEventListener('focus', () => {
    if (node.value.length > 1) {
      // Create a proper Event object that will trigger the search
      const inputEvent = new Event('input', { bubbles: true });
      Object.defineProperty(inputEvent, 'target', { value: node, enumerable: true });
      handleInput(inputEvent);
    }
  });
  node.addEventListener('blur', () => {
    setTimeout(() => {
      if (dropdown) dropdown.style.display = 'none';
    }, 200);
  });
  
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