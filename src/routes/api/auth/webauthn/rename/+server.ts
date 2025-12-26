import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateAuthenticator } from '$lib/server/authenticatorService';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  try {
    const session = locals.session;
    if (!session?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    const env = platform?.env;
    if (!env?.BETA_USERS_KV) return json({ error: 'Service unavailable' }, { status: 503 });

    const body = await request.json();
    const { credentialID, name } = body || {};
    if (!credentialID || typeof credentialID !== 'string') return json({ error: 'Invalid credential ID' }, { status: 400 });
    if (name !== undefined && typeof name !== 'string') return json({ error: 'Invalid name' }, { status: 400 });

    await updateAuthenticator(env.BETA_USERS_KV, session.id, credentialID, {
      name: name || null
    });

    return json({ success: true });
  } catch (err) {
    console.error('[WebAuthn Rename] Error:', err);
    return json({ error: 'Failed to rename passkey' }, { status: 500 });
  }
};