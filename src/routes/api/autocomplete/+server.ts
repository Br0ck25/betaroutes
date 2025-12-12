// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const query = url.searchParams.get('q');
  
  // [!code ++] 1. Cost Protection: Minimum Character Limit
  // Do not search until user types at least 3 chars to avoid massive wildcard matches
  if (!query || query.length < 3) return json([]);
  
  const kv = platform?.env?.BETA_PLACES_KV;
  if (!kv) return json([]);
  
  try {
    const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
    
    // Truncate search to max 10 chars
    const searchLen = Math.min(10, normalizedQuery.length);
    const searchPrefix = normalizedQuery.substring(0, searchLen);
    
    // Note: Assuming your keys are stored with this prefix structure.
    // If your keys are just "123mainst...", remove the "prefix:" part below.
    const prefixKey = `prefix:${searchPrefix}`; 
    
    // [!code changed] 2. N+1 Prevention: Strict Limit
    // We limit the LIST operation to 10 keys.
    // This ensures we never trigger 500+ GET operations from a single user keystroke.
    const { keys } = await kv.list({ prefix: prefixKey, limit: 10 });
    
    if (keys.length === 0) {
       return json([]);
    }

    // Fetch values (now capped at max 10 reads)
    const valuePromises = keys.map(async (k) => {
      const value = await kv.get(k.name, 'text');
      return value ? JSON.parse(value) : null;
    });
    
    const values = await Promise.all(valuePromises);
    
    // Deduplication & Filtering
    const seenAddresses = new Set<string>();
    const results = values
      .filter((v): v is any => v !== null)
      .filter(v => {
        const addr = v.formatted_address || v.name;
        // Verify match (since prefix search is broad)
        const normalizedAddr = addr.toLowerCase().replace(/\s+/g, '');
        if (!normalizedAddr.includes(normalizedQuery)) return false;

        if (seenAddresses.has(addr)) return false;
        seenAddresses.add(addr);
        return true;
      });
      
    return json(results);

  } catch (error) {
    console.error(`❌ [AUTOCOMPLETE API] Error:`, error);
    return json({ error: 'Failed' }, { status: 500 });
  }
};