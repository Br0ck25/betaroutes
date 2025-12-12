// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const startTime = Date.now();
  const query = url.searchParams.get('q');
  
  // ... (keep your existing logs) ...
  console.log(`   Query: "${query}"`);

  if (!query) return json([]);
  
  const kv = platform?.env?.BETA_PLACES_KV;
  if (!kv) return json([]);
  
  try {
    const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
    
    // FIX: Truncate search to max 10 chars to match the bucket keys generated in the setter
    const searchLen = Math.min(10, normalizedQuery.length);
    const searchPrefix = normalizedQuery.substring(0, searchLen);
    
    const prefixKey = `prefix:${searchPrefix}`;
    console.log(`   Searching KV with prefix: "${prefixKey}"`);
    
    const { keys } = await kv.list({ prefix: prefixKey });
    
    // ... (rest of your logic remains the same) ...
    
    if (keys.length === 0) {
       // ...
       return json([]);
    }

    // Fetch and process values...
    const valuePromises = keys.map(async (k) => {
      const value = await kv.get(k.name, 'text');
      return value ? JSON.parse(value) : null;
    });
    
    // ... (rest of your deduplication logic) ...
    const values = await Promise.all(valuePromises);
    
    // Deduplication logic...
    const seenAddresses = new Set<string>();
    const results = values
      .filter((v): v is any => v !== null)
      .filter(v => {
        const addr = v.formatted_address || v.name;
        // Filter out false positives from the truncated prefix
        const normalizedAddr = addr.toLowerCase().replace(/\s+/g, '');
        if (!normalizedAddr.includes(normalizedQuery)) return false;

        if (seenAddresses.has(addr)) return false;
        seenAddresses.add(addr);
        return true;
      })
      .slice(0, 10);
      
    // ...
    return json(results);

  } catch (error) {
    console.error(`❌ [AUTOCOMPLETE API] Error:`, error);
    return json({ error: 'Failed' }, { status: 500 });
  }
};