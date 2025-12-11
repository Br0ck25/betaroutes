// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;
  
  // DISABLE GOOGLE FOR TESTING
  // let autocompleteService: google.maps.places.AutocompleteService | null = null;
  // let sessionToken: google.maps.places.AutocompleteSessionToken | null = null;

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
    
    // Event: Focus
    node.addEventListener('focus', () => {
        console.log('[Auto-Debug] Input focused. Google load skipped for KV testing.');
        if (node.value.length > 1) handleInput();
    });

    // Event: Blur
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
        console.log(`[Auto-Debug] Fetching local API for: "${query}"...`);
        
        // --- STEP 1: STRICT LOCAL CHECK ---
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        
        if (!res.ok) {
            console.error('[Auto-Debug] API returned error status:', res.status);
            return;
        }

        const localResults = await res.json();
        console.log('[Auto-Debug] API Response:', localResults);

        if (localResults && localResults.length > 0) {
           renderSuggestions(localResults, 'local');
        } else {
            console.warn('[Auto-Debug] No results found in KV.');
            renderSuggestions([], 'local'); // Clear list
        }

        // --- STEP 2: GOOGLE DISABLED ---
        // console.log('[Auto-Debug] Google Fallback is DISABLED.');

      } catch (err) {
        console.error('[Auto-Debug] Client fetch error:', err);
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

    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '4px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: '#2e7d32',
        backgroundColor: '#e8f5e9',
        borderBottom: '1px solid #eee'
    });
    header.textContent = 'KV DEBUG RESULTS';
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      const text = item.formatted_address || item.name;
      
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.2em;">🗄️</span> 
          <span style="font-weight: 500;">${text}</span>
        </div>
      `;
      
      Object.assign(li.style, {
        padding: '10px 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #eee',
        color: '#333'
      });
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        selectLocalItem(item);
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
  }

  function selectLocalItem(item: any) {
    const place = {
      formatted_address: item.formatted_address || item.name,
      name: item.name,
      geometry: item.geometry
    };
    triggerSelection(place);
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