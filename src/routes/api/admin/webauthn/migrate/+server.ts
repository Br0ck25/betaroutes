import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { normalizeCredentialID, toBase64Url } from '$lib/server/webauthn-utils';

export const POST: RequestHandler = async ({ request, platform, url }) => {
  const env = platform?.env;
  const secret = env?.ADMIN_MIGRATE_SECRET;
  
  if (!secret) {
    return json({ error: 'Migration disabled (no secret configured)' }, { status: 403 });
  }
  
  const provided = (request.headers.get('x-admin-secret') || url.searchParams.get('admin_secret')) || '';
  if (provided !== secret) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    // List authenticator keys
    const kv = env.BETA_USERS_KV as KVNamespace;
    if (!kv || !kv.list) {
      return json({ error: 'KV not available or unsupported in this environment' }, { status: 500 });
    }
    
    const prefix = 'authenticators:';
    let cursor: string | undefined = undefined;
    let migrated = 0;
    let skipped = 0;
    let updatedUsers: string[] = [];
    
    do {
      const res = await kv.list({ prefix, cursor, limit: 100 });
      cursor = res?.cursor;
      
      for (const item of res.keys) {
        try {
          const key = item.name; // authenticators:{userId}
          const userId = key.replace(prefix, '');
          const data = await kv.get(key, 'json') as any[] | null;
          
          if (!Array.isArray(data)) continue;
          
          let modified = false;
          for (let i = 0; i < data.length; i++) {
            const auth = data[i];
            if (!auth || !auth.credentialID) continue;
            
            if (typeof auth.credentialID !== 'string') {
              // Try to normalize
              try {
                const normalized = normalizeCredentialID(auth.credentialID);
                if (normalized) {
                  auth.credentialID = normalized;
                  modified = true;
                  migrated++;
                  
                  // Normalize public key if present
                  if (auth.credentialPublicKey && typeof auth.credentialPublicKey !== 'string') {
                    try {
                      auth.credentialPublicKey = toBase64Url(auth.credentialPublicKey);
                    } catch (e) {
                      console.warn('[webauthn migrate] failed to normalize public key for user', userId, e);
                    }
                  }
                  
                  // Update credential index - FIXED: proper function call syntax
                  try {
                    await kv.put(`credential:${auth.credentialID}`, userId);
                  } catch (e) {
                    console.warn('[webauthn migrate] failed to write credential index', auth.credentialID, e);
                  }
                } else {
                  skipped++;
                }
              } catch (e) {
                console.warn('[webauthn migrate] failed to normalize credential for user', userId, e);
                skipped++;
              }
            }
          }
          
          if (modified) {
            await kv.put(key, JSON.stringify(data));
            updatedUsers.push(userId);
          }
        } catch (e) {
          console.warn('[webauthn migrate] error processing key', item.name, e);
        }
      }
    } while (cursor);
    
    return json({ 
      success: true, 
      migrated, 
      skipped, 
      updatedUsersCount: updatedUsers.length,
      updatedUsers: updatedUsers.slice(0, 10) // Return first 10 for debugging
    });
  } catch (err) {
    console.error('[webauthn migrate] error', err instanceof Error ? err.stack : err);
    return json({ 
      error: 'Migration failed', 
      details: err instanceof Error ? err.message : String(err) 
    }, { status: 500 });
  }
};