// src/lib/utils/autocomplete.ts - DEBUGGING VERSION
import type { Action } from "svelte/action";

export const autocomplete: Action<HTMLInputElement, { apiKey: string }> = (node, params) => {
  console.log('🔧 [AUTOCOMPLETE] Action attached to input:', node);
  
  let dropdown: HTMLDivElement | null = null;
  let debounceTimer: any;
  
  // Create a VERY VISIBLE dropdown for debugging
  function createDropdown() {
    dropdown = document.createElement('div');
    dropdown.id = 'autocomplete-debug-dropdown';
    
    // SUPER VISIBLE STYLING
    Object.assign(dropdown.style, {
      position: 'fixed',
      top: '200px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '400px',
      backgroundColor: '#FF0000', // RED BACKGROUND - impossible to miss
      color: 'white',
      border: '5px solid yellow',
      borderRadius: '12px',
      padding: '20px',
      zIndex: '999999',
      fontSize: '18px',
      fontWeight: 'bold',
      textAlign: 'center',
      display: 'none',
      boxShadow: '0 0 50px rgba(255,0,0,0.8)'
    });
    
    dropdown.innerHTML = '🔴 AUTOCOMPLETE TEST - If you see this, the action is working!';
    document.body.appendChild(dropdown);
    
    console.log('✅ [AUTOCOMPLETE] Dropdown created and added to DOM');
  }
  
  async function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    console.log('📝 [AUTOCOMPLETE] Input detected:', value);
    
    if (!dropdown) {
      console.error('❌ [AUTOCOMPLETE] Dropdown not created!');
      return;
    }
    
    // Show dropdown immediately
    dropdown.style.display = 'block';
    dropdown.innerHTML = `⏳ Loading results for: "${value}"`;
    
    if (!value || value.length < 2) {
      dropdown.style.display = 'none';
      return;
    }
    
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        console.log('🌐 [AUTOCOMPLETE] Fetching from API...');
        const url = `/api/autocomplete?q=${encodeURIComponent(value)}`;
        console.log('🌐 [AUTOCOMPLETE] URL:', url);
        
        const res = await fetch(url);
        const data = await res.json();
        
        console.log('✅ [AUTOCOMPLETE] Got response:', data);
        
        if (data && data.length > 0) {
          dropdown!.innerHTML = `
            <div style="margin-bottom: 10px;">✅ Found ${data.length} results:</div>
            ${data.map((item: any) => `
              <div style="background: white; color: black; padding: 10px; margin: 5px 0; border-radius: 6px; cursor: pointer;" 
                   onclick="alert('Clicked: ${item.formatted_address}')">
                📍 ${item.formatted_address || item.name}
              </div>
            `).join('')}
          `;
        } else {
          dropdown!.innerHTML = '❌ No results found';
        }
        
      } catch (err) {
        console.error('❌ [AUTOCOMPLETE] Fetch error:', err);
        dropdown!.innerHTML = `⚠️ Error: ${err}`;
      }
    }, 500);
  }
  
  // Initialize
  createDropdown();
  node.addEventListener('input', handleInput);
  node.addEventListener('focus', () => {
    console.log('👁️ [AUTOCOMPLETE] Input focused');
  });
  
  console.log('✅ [AUTOCOMPLETE] Event listeners attached');
  
  return {
    destroy() {
      console.log('🗑️ [AUTOCOMPLETE] Cleaning up');
      if (dropdown) dropdown.remove();
      node.removeEventListener('input', handleInput);
    }
  };
};