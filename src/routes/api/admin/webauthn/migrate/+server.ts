import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { normalizeCredentialID, credentialToBase64urlForStorage, toBase64Url } from '$lib/server/webauthn-utils';
import { getUserAuthenticators, addAuthenticator } from '$lib/server/authenticatorService';

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
              // try normalize
              const normalized = normalizeCredentialID(auth.credentialID);
              if (normalized) {
                auth.credentialID = normalized;
                modified = true;
                migrated++;

                // normalize public key if present
                if (auth.credentialPublicKey && typeof auth.credentialPublicKey !== 'string') {
                  try {
                    auth.credentialPublicKey = credentialToBase64urlForStorage(auth.credentialPublicKey);
                  } catch (e) {
                    console.warn('[webauthn migrate] failed to coerce public key for user', userId, e);
                  }
                }

                // update credential index
                try {
                  await kv.put(`credential:${auth.credentialID}`, userId);
                } catch (e) {
                  console.warn('[webauthn migrate] failed to write credential index', auth.credentialID, e);
                }
              } else {
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

    return json({ success: true, migrated, skipped, updatedUsersCount: updatedUsers.length });
  } catch (err) {
    console.error('[webauthn migrate] error', err instanceof Error ? err.stack : err);
    return json({ error: 'Migration failed', details: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
};