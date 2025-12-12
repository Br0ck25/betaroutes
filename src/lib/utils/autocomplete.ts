// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;
  
  function initUI() {
    suggestionsList = document.createElement('ul');
    suggestionsList.id = `autocomplete-${Math.random().toString(36).substr(2, 9)}`;
    
    Object.assign(suggestionsList.style, {
      position: 'fixed', // ← Changed from absolute to fixed
      zIndex: '9999',    // ← Increased z-index
      backgroundColor: 'white',
      border: '2px solid #FF7F50', // ← Made more visible for debugging
      borderRadius: '0 0 12px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      listStyle: 'none',
      padding: '8px 0',
      margin: '0',
      width: '100%',
      maxHeight: '300px',
      overflowY: 'auto',
      display: 'none',
      fontSize: '16px',
      fontFamily: 'inherit'
    });
    
    document.body.appendChild(suggestionsList);
    console.log('[Autocomplete] UI initialized');

    node.addEventListener('input', handleInput);
    node.addEventListener('focus', () => {
        if (node.value.length > 1) handleInput();
    });

    node.addEventListener('blur', () => {
      setTimeout(() => {
        if(suggestionsList) suggestionsList.style.display = 'none';
      }, 200);
    });
  }

  function updatePosition() {
    if (!suggestionsList) return;
    const rect = node.getBoundingClientRect();
    Object.assign(suggestionsList.style, {
      top: `${rect.bottom + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`
    });
  }

  function handleInput() {
    const query = node.value;
    
    console.log('[Autocomplete] Input:', query);
    
    // Update position on every input
    updatePosition();

    if (!query || query.length < 2) {
      if(suggestionsList) suggestionsList.style.display = 'none';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        console.log('[Autocomplete] Fetching:', `/api/autocomplete?q=${query}`);
        
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        
        console.log('[Autocomplete] Results:', results);
        
        if (results && results.length > 0) {
            renderSuggestions(results);
        } else {
            renderEmptyState();
        }
      } catch (err) {
        console.error('[Autocomplete] Fetch error:', err);
        renderError();
      }
    }, 300);
  }

  function renderError() {
      if (!suggestionsList) return;
      suggestionsList.innerHTML = '';
      const li = document.createElement('li');
      Object.assign(li.style, { 
        padding: '12px 16px', 
        color: '#DC2626', 
        fontStyle: 'italic',
        fontSize: '15px'
      });
      li.textContent = '⚠️ Error loading suggestions';
      suggestionsList.appendChild(li);
      suggestionsList.style.display = 'block';
      updatePosition();
  }

  function renderEmptyState() {
      if (!suggestionsList) return;
      suggestionsList.innerHTML = '';
      const li = document.createElement('li');
      Object.assign(li.style, { 
        padding: '12px 16px', 
        color: '#9CA3AF', 
        fontStyle: 'italic',
        fontSize: '15px',
        textAlign: 'center'
      });
      li.textContent = '🔍 No matches found';
      suggestionsList.appendChild(li);
      suggestionsList.style.display = 'block';
      updatePosition();
  }

  function renderSuggestions(items: any[]) {
    if (!suggestionsList) return;
    suggestionsList.innerHTML = '';

    // Add a header to show data source
    const header = document.createElement('li');
    Object.assign(header.style, {
        padding: '6px 16px',
        fontSize: '12px',
        fontWeight: '700',
        color: '#059669',
        backgroundColor: '#ECFDF5',
        borderBottom: '1px solid #D1FAE5',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    });
    header.textContent = `✓ ${items.length} Result${items.length !== 1 ? 's' : ''} from Database`;
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      const text = item.formatted_address || item.name;
      
      li.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px 16px;">
          <span style="font-size: 1.3em;">📍</span> 
          <div style="flex: 1;">
            <div style="font-weight: 600; font-size: 15px; color: #111827;">${text}</div>
            ${item.source === 'kv' ? '<div style="font-size: 12px; color: #059669; margin-top: 2px;">✓ Saved Address</div>' : ''}
          </div>
        </div>
      `;
      
      Object.assign(li.style, {
        cursor: 'pointer',
        borderBottom: '1px solid #F3F4F6',
        transition: 'background 0.15s'
      });
      
      li.addEventListener('mouseenter', () => {
        li.style.backgroundColor = '#F9FAFB';
      });
      
      li.addEventListener('mouseleave', () => {
        li.style.backgroundColor = 'white';
      });
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        selectItem(item);
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
    updatePosition();
    
    console.log('[Autocomplete] Rendered', items.length, 'suggestions');
  }

  function selectItem(item: any) {
    const place = {
      formatted_address: item.formatted_address || item.name,
      name: item.name,
      geometry: item.geometry
    };
    
    if(suggestionsList) suggestionsList.style.display = 'none';
    node.value = place.formatted_address || place.name;
    node.dispatchEvent(new CustomEvent('place-selected', { detail: place }));
    
    console.log('[Autocomplete] Selected:', place);
  }

  initUI();

  // Update position on scroll/resize
  window.addEventListener('scroll', updatePosition);
  window.addEventListener('resize', updatePosition);

  return {
    destroy() {
      if (suggestionsList) suggestionsList.remove();
      node.removeEventListener('input', handleInput);
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    }
  };
};