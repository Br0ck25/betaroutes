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
  // DEBUG: show which bindings the platform actually contains
  try { console.log('PLATFORM ENV KEYS:', Object.keys(platform?.env || {})); } catch(e) { console.log('PLATFORM LOG ERROR', e); }

  const q = event.url.searchParams.get('q') ?? '';
  if (q === 'debugkv') {
    // return list of env keys so you can see if BETA_PLACES_KV is present
    return json({ env: Object.keys(platform?.env || {}) });
  }

  if (!q || q.length < 2) return json([]);

  // Normalize query for prefix search + storage key
  const prefix = q.toLowerCase().trim();
  const placesKV = platform?.env?.BETA_PLACES_KV;

  if (!placesKV) {
    console.warn('BETA_PLACES_KV is missing on platform.env');
    return json([{ formatted_address: "Error: KV binding missing", name: "System Error" }]);
  }

  try {
    // 1) prefix list
    const list = await placesKV.list({ prefix, limit: 6 });
    const results:any[] = [];

    for (const key of list.keys) {
      try {
        const raw = await placesKV.get(key.name);
        if (!raw) throw new Error('empty');
        results.push(JSON.parse(raw));
      } catch (e) {
        // fallback to exposing the key (so we can see prefix working)
        results.push({
          formatted_address: key.name,
          name: key.name,
          _kvFallback: true,
          geometry: { location: { lat: 0, lng: 0 } }
        });
      }
    }

    if (results.length > 0) {
      return json(results);
    }

    // 2) no KV hits -> Google fallback + write to KV
    const googleApiKey = platform?.env?.PUBLIC_GOOGLE_MAPS_API_KEY || process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!googleApiKey) {
      return json([{ formatted_address: "No results - Google API key missing", name: "Error" }]);
    }

    const googleResults = await fetchGoogleFallback(q, googleApiKey);

    // store normalized keys into KV (lowercase trimmed)
    await Promise.all(googleResults.map(place => {
      const key = (place.formatted_address || place.name || q).toLowerCase().trim();
      const value = JSON.stringify({ ...place, cachedAt: new Date().toISOString() });
      // TTL optional — adjust as needed
      return placesKV.put(key, value, { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
    }));

    return json(googleResults);
  } catch (err) {
    console.error('Autocomplete handler error:', err);
    return json([{ formatted_address: "Server Error", name: String(err) }]);
  }
};
