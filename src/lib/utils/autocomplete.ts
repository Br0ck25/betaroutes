// src/lib/utils/autocomplete.ts
import type { Action } from "svelte/action";

console.log('[Autocomplete] 🟢 File Loaded');

let googleLoaded = false;

// Load Google Places only once
export function loadGoogle(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    if (googleLoaded) return resolve();
    if ((window as any).google?.maps?.places) {
      googleLoaded = true;
      return resolve();
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => {
      console.log('[Autocomplete] 🗺️ Google Maps script loaded');
      googleLoaded = true;
      resolve();
    };

    document.head.appendChild(script);
  });
}

// Helper to save a Google result to KV
async function saveToKV(place: google.maps.places.PlaceResult) {
  console.log('[Autocomplete] 💾 Attempting to save place to KV:', place.name);

  if (!place.formatted_address && !place.name) {
      console.error('[Autocomplete] ❌ Cannot save: Missing address/name', place);
      return;
  }

  try {
    const payload = {
      formatted_address: place.formatted_address,
      name: place.name,
      geometry: place.geometry ? {
        location: {
            lat: place.geometry.location?.lat(),
            lng: place.geometry.location?.lng()
        }
      } : null,
      place_id: place.place_id,
      types: place.types
    };

    const res = await fetch('/api/autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await res.json();
    console.log('[Autocomplete] ✅ Save API Response:', result);

  } catch (e) {
    console.error('[Autocomplete] ❌ Save Failed:', e);
  }
}

// New Hybrid Autocomplete Setup
export function setupHybridAutocomplete(
  input: HTMLInputElement,
  callback: (place: any) => void
) {
  console.log('[Autocomplete] 🔌 Setting up hybrid for input:', input.id);
  
  let googleAc: google.maps.places.Autocomplete | null = null;
  let debounce: any;

  // Create wrapper for custom dropdown
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const list = document.createElement('div');
  Object.assign(list.style, {
    position: 'absolute',
    top: '100%',
    left: '0',
    width: '100%',
    background: 'white',
    border: '1px solid #ddd',
    borderTop: 'none',
    zIndex: '1000',
    maxHeight: '200px',
    overflowY: 'auto',
    display: 'none',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    borderRadius: '0 0 4px 4px'
  });
  wrapper.appendChild(list);

  const closeList = () => {
    list.style.display = 'none';
    list.innerHTML = '';
  };

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target as Node)) closeList();
  });

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (query.length < 2) {
        closeList();
        return;
    }

    clearTimeout(debounce);
    debounce = setTimeout(async () => {
        try {
            console.log('[Autocomplete] 🔍 Searching KV for:', query);
            const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
            const results = await res.json();
            console.log(`[Autocomplete] 🎯 Found ${results.length} local matches`);

            if (results && results.length > 0) {
                list.innerHTML = '';
                results.forEach((place: any) => {
                    const item = document.createElement('div');
                    item.innerHTML = `<span style="color:green">⚡</span> ${place.formatted_address || place.name}`;
                    Object.assign(item.style, {
                        padding: '10px',
                        cursor: 'pointer',
                        borderBottom: '1px solid #eee'
                    });
                    
                    item.onclick = () => {
                        console.log('[Autocomplete] 🖱️ Selected from KV');
                        input.value = place.formatted_address || place.name;
                        closeList();
                        if (place.geometry?.location) {
                             place.geometry.location.lat = () => place.geometry.location.lat;
                             place.geometry.location.lng = () => place.geometry.location.lng;
                        }
                        callback(place);
                    };
                    list.appendChild(item);
                });
                list.style.display = 'block';
            } else {
                closeList();
                // Fallback to Google
                if (!googleAc && (window as any).google?.maps?.places) {
                    console.log('[Autocomplete] 🌐 Initializing Google fallback');
                    googleAc = new google.maps.places.Autocomplete(input, {
                        types: ["geocode"],
                        fields: ["formatted_address", "geometry", "name", "place_id", "types"],
                    });
                    
                    googleAc.addListener('place_changed', () => {
                        console.log('[Autocomplete] 📍 Google place_changed fired');
                        const place = googleAc!.getPlace();
                        saveToKV(place); 
                        callback(place);
                    });
                }
            }
        } catch (e) {
            console.error('[Autocomplete] Error:', e);
        }
    }, 300);
  });
}

// Keep export for backward compatibility
export const autocomplete: Action<HTMLInputElement, { apiKey: string }> =
  (node, params) => {
    async function init() {
        if (!params?.apiKey) return;
        await loadGoogle(params.apiKey);
        setupHybridAutocomplete(node, (place) => {
             node.dispatchEvent(
                new CustomEvent("place-selected", { detail: place })
             );
        });
    }
    init();
    return {};
  };