// src/routes/api/autocomplete/cache/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const { query, results } = await request.json();
    
    if (!query || !results || !Array.isArray(results)) {
      return json({ error: 'Invalid request' }, { status: 400 });
    }
    
    const kv = platform?.env?.BETA_PLACES_KV;
    if (!kv) {
      console.warn('[Cache] BETA_PLACES_KV not available');
      return json({ cached: false });
    }
    
    // Collect all write operations into a single array
    const putPromises: Promise<void>[] = [];
    
    for (const result of results) {
      const address = result.formatted_address || result.name || '';
      const normalizedAddress = address.toLowerCase().replace(/\s+/g, '');
      
      // 1. Full address key
      putPromises.push(
        kv.put(normalizedAddress, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 90 })
      );
      
      // 2. Prefix keys (every 2-10 characters)
      for (let len = 2; len <= Math.min(10, normalizedAddress.length); len++) {
        const prefix = normalizedAddress.substring(0, len);
        const key = `prefix:${prefix}:${normalizedAddress}`;
        
        putPromises.push(
          kv.put(key, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 90 })
        );
      }
    }
    
    // Wait for ALL writes to complete before returning
    await Promise.all(putPromises);
    
    console.log(`✅ [CACHE] Stored ${results.length} addresses (${putPromises.length} keys) to KV`);
    
    return json({ 
      cached: true, 
      count: results.length 
    });
    
  } catch (err) {
    console.error('[Cache] Error:', err);
    return json({ error: 'Failed to cache' }, { status: 500 });
  }
};