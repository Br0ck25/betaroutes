import type { Action } from "svelte/action";

// Dummy export to prevent import errors in other files
export function loadGoogle(key: string) { return Promise.resolve(); }

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let suggestionsList: HTMLUListElement | null = null;
  let debounceTimer: any;
  
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

  function handleInput() {
    const query = node.value;
    
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
        // CALL LOCAL API ONLY
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        renderSuggestions(results);
      } catch (err) {
        console.error('Autocomplete error', err);
      }
    }, 300);
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
        padding: '4px 12px',
        fontSize: '11px',
        fontWeight: 'bold',
        color: '#2e7d32',
        backgroundColor: '#e8f5e9',
        borderBottom: '1px solid #eee'
    });
    header.textContent = 'KV DATABASE RESULTS';
    suggestionsList.appendChild(header);

    items.forEach(item => {
      const li = document.createElement('li');
      // Handle both standard objects and our debug/error objects
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
        selectItem(item);
      });

      suggestionsList!.appendChild(li);
    });

    suggestionsList.style.display = 'block';
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
  }

  initUI();

  return {
    destroy() {
      if (suggestionsList) suggestionsList.remove();
      node.removeEventListener('input', handleInput);
    }
  };
};