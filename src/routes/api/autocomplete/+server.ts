// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function fetchGoogleFallback(query: string, apiKey: string) {
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!data.predictions) return [];
  return data.predictions.map((p:any) => ({
    formatted_address: p.description,
    name: p.structured_formatting?.main_text ?? p.description,
    source: 'google'
  }));
}

export const GET: RequestHandler = async (event) => {
  const platform = event.platform;
  const q = event.url.searchParams.get('q') ?? '';
  
  if (!q || q.length < 2) return json([]);

  const placesKV = platform?.env?.BETA_PLACES_KV;

  if (!placesKV) {
    console.warn('[Autocomplete] BETA_PLACES_KV binding missing');
    
    // Fallback to Google if KV unavailable
    const googleApiKey = platform?.env?.PUBLIC_GOOGLE_MAPS_API_KEY;
    if (googleApiKey) {
        const results = await fetchGoogleFallback(q, googleApiKey);
        return json(results);
    }
    
    return json([{ formatted_address: "Error: No autocomplete available", name: "System Error" }]);
  }

  try {
    // Search KV with normalized lowercase prefix
    const searchKey = q.toLowerCase().trim();
    console.log(`[Autocomplete] Searching KV with prefix: "${searchKey}"`);
    
    const list = await placesKV.list({ prefix: searchKey, limit: 10 });
    console.log(`[Autocomplete] Found ${list.keys.length} KV keys`);
    
    const results: any[] = [];
    const seen = new Set<string>(); // ← DEDUPLICATION

    // Fetch actual data for each key
    for (const key of list.keys) {
      try {
        const raw = await placesKV.get(key.name);
        if (raw) {
          const parsed = JSON.parse(raw);
          const addr = parsed.formatted_address || parsed.name || key.name;
          
          // ← DEDUPLICATE by normalized address
          const normalizedAddr = addr.toLowerCase().trim();
          if (!seen.has(normalizedAddr)) {
            seen.add(normalizedAddr);
            results.push({
              formatted_address: addr,
              name: parsed.name || addr.split(',')[0].trim(),
              source: 'kv'
            });
          }
        }
      } catch (e) {
        console.error(`[Autocomplete] Failed to parse KV entry ${key.name}:`, e);
      }
    }

    // If we have KV results, return them
    if (results.length > 0) {
      console.log(`[Autocomplete] Returning ${results.length} unique results from KV`);
      return json(results);
    }

    // No KV results → Fetch from Google and cache
    console.log('[Autocomplete] No KV results, fetching from Google...');
    const googleApiKey = platform?.env?.PUBLIC_GOOGLE_MAPS_API_KEY;
    
    if (!googleApiKey) {
      return json([{ formatted_address: "No results found", name: "No matches" }]);
    }

    const googleResults = await fetchGoogleFallback(q, googleApiKey);
    
    // Cache Google results in KV (fire and forget)
    if (googleResults.length > 0) {
      console.log(`[Autocomplete] Caching ${googleResults.length} Google results...`);
      
      googleResults.forEach(async (place) => {
        try {
          const addr = place.formatted_address || place.name;
          if (!addr) return;
          
          // Store with normalized key
          const cacheKey = addr.toLowerCase().trim();
          await placesKV.put(cacheKey, JSON.stringify({
            formatted_address: place.formatted_address,
            name: place.name,
            source: 'google',
            cachedAt: new Date().toISOString()
          }), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days
          
          console.log(`[Autocomplete] Cached: ${cacheKey}`);
        } catch (e) {
          console.error('[Autocomplete] Cache error:', e);
        }
      });
    }

    return json(googleResults);
    
  } catch (err) {
    console.error('[Autocomplete] Handler error:', err);
    return json([{ formatted_address: "Server Error", name: String(err) }]);
  }
};