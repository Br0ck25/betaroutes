// src/lib/utils/autocomplete.ts - Google Places Style
import type { Action } from "svelte/action";

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  let dropdown: HTMLDivElement | null = null;
  let debounceTimer: any;
  
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
    const value = (e.target as HTMLInputElement).value;
    
    updatePosition();
    
    if (!value || value.length < 2) {
      if (dropdown) dropdown.style.display = 'none';
      return;
    }
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const url = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data && data.length > 0) {
          renderResults(data);
        } else {
          renderEmpty();
        }
      } catch (err) {
        console.error('[Autocomplete] Error:', err);
        renderError();
      }
    }, 300);
  }
  
  function renderResults(items: any[]) {
    if (!dropdown) return;
    dropdown.innerHTML = '';
    
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'pac-item';
      
      const text = item.formatted_address || item.name;
      const parts = text.split(',');
      const mainText = parts[0]?.trim() || '';
      const secondaryText = parts.slice(1).join(',').trim();
      
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
    node.value = item.formatted_address || item.name;
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
    if (node.value.length > 1) handleInput(new Event('input'));
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