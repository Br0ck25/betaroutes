// src/routes/api/autocomplete/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const startTime = Date.now();
  const query = url.searchParams.get('q');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 [AUTOCOMPLETE API] New search request');
  console.log(`   Query: "${query}"`);
  
  if (!query) {
    console.log('❌ [AUTOCOMPLETE API] No query provided');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return json([]);
  }
  
  const kv = platform?.env?.BETA_PLACES_KV;
  if (!kv) {
    console.log('⚠️  [AUTOCOMPLETE API] KV namespace not available');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return json([]);
  }
  
  try {
    // Normalize the query for searching
    const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
    console.log(`   Normalized: "${normalizedQuery}"`);
    
    // Search for prefix keys that match this query
    const prefixKey = `prefix:${normalizedQuery}`;
    console.log(`   Searching KV with prefix: "${prefixKey}"`);
    
    const { keys } = await kv.list({ prefix: prefixKey });
    console.log(`   Prefix keys found: ${keys.length}`);
    
    if (keys.length > 0) {
      console.log('   First 3 keys:', keys.slice(0, 3).map(k => k.name));
    }
    
    if (keys.length === 0) {
      const elapsed = Date.now() - startTime;
      console.log(`❌ [AUTOCOMPLETE API] KV Cache MISS - 0 results in ${elapsed}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return json([]);
    }
    
    // Fetch values for all matching keys
    const valuePromises = keys.map(async (k) => {
      const value = await kv.get(k.name, 'text'); // Get as text first
      if (!value) return null;
      
      try {
        return JSON.parse(value); // Parse it ourselves
      } catch (err) {
        console.error(`[AUTOCOMPLETE API] Failed to parse JSON for key ${k.name}:`, err);
        return null;
      }
    });
    const values = await Promise.all(valuePromises);
    
    // Filter out nulls and deduplicate by formatted_address
    const seenAddresses = new Set<string>();
    const results = values
      .filter((v): v is any => v !== null)
      .filter(v => {
        const addr = v.formatted_address || v.name;
        if (seenAddresses.has(addr)) return false;
        seenAddresses.add(addr);
        return true;
      })
      .slice(0, 10);
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ [AUTOCOMPLETE API] KV Cache HIT - ${results.length} results in ${elapsed}ms`);
    console.log('   Results:');
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.formatted_address || r.name}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return json(results);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [AUTOCOMPLETE API] Error after ${elapsed}ms:`, error);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return json({ error: 'Failed to fetch autocomplete results' }, { status: 500 });
  }
};