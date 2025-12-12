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
    
    // Store each result with MULTIPLE keys for better matching
    const cachePromises = results.flatMap(async (result) => {
      const address = result.formatted_address || result.name || '';
      const normalizedAddress = address.toLowerCase().replace(/\s+/g, '');
      
      // Generate multiple prefix keys for this address
      const keys = [];
      
      // 1. Full address key (original behavior)
      keys.push(normalizedAddress);
      
      // 2. Prefix keys (every 2-10 characters from start)
      for (let len = 2; len <= Math.min(10, normalizedAddress.length); len++) {
        const prefix = normalizedAddress.substring(0, len);
        keys.push(`prefix:${prefix}:${normalizedAddress}`);
      }
      
      // Store with all keys
      return keys.map(key => 
        kv.put(
          key,
          JSON.stringify(result),
          { expirationTtl: 60 * 60 * 24 * 90 } // 90 days
        )
      );
    });
    
    await Promise.all(cachePromises.flat());
    
    console.log(`✅ [CACHE] Stored ${results.length} addresses with prefix keys to KV`);
    
    return json({ 
      cached: true, 
      count: results.length 
    });
    
  } catch (err) {
    console.error('[Cache] Error:', err);
    return json({ error: 'Failed to cache' }, { status: 500 });
  }
};