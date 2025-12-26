import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getUserIdByCredentialID } from '$lib/server/authenticatorService';

export const GET: RequestHandler = async ({ url, platform }) => {
  const env = platform?.env;
  const secret = env?.ADMIN_MIGRATE_SECRET;
  if (!secret) return json({ error: 'Disabled' }, { status: 403 });

  const provided = url.searchParams.get('admin_secret') || '';
  if (provided !== secret) return json({ error: 'Unauthorized' }, { status: 401 });

  const credential = url.searchParams.get('credential');
  if (!credential) return json({ error: 'Missing credential' }, { status: 400 });

  try {
    const kv = env.BETA_USERS_KV as KVNamespace;
    if (!kv) return json({ error: 'KV not available' }, { status: 503 });

    const userId = await getUserIdByCredentialID(kv, credential);
    return json({ found: !!userId, userId: userId || null });
  } catch (e) {
    console.error('[webauthn check] error', e);
    return json({ error: 'Internal error', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};