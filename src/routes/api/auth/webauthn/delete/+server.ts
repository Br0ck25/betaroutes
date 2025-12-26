import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeAuthenticator } from '$lib/server/authenticatorService';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
  try {
    // Check if user is authenticated
    const session = locals.session;
    if (!session?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env?.BETA_USERS_KV || !env?.BETA_SESSIONS_KV) {
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    // Get the credential ID to delete
    const body = await request.json();
    const { credentialID } = body;

    if (!credentialID || typeof credentialID !== 'string') {
      return json({ error: 'Invalid credential ID' }, { status: 400 });
    }

    // Remove the authenticator
    await removeAuthenticator(env.BETA_USERS_KV, session.id, credentialID);

    // If this credential was used to create the current session, remove it from session KV
    try {
      const sessionId = cookies.get('session_id');
      if (sessionId) {
        const sessionStr = await env.BETA_SESSIONS_KV.get(sessionId);
        if (sessionStr) {
          const sessionObj = JSON.parse(sessionStr);
          if (sessionObj.lastUsedCredentialID && sessionObj.lastUsedCredentialID === credentialID) {
            delete sessionObj.lastUsedCredentialID;
            await env.BETA_SESSIONS_KV.put(sessionId, JSON.stringify(sessionObj));
            console.log('[WebAuthn Delete] Cleared lastUsedCredentialID from session:', sessionId);
          }
        }
      }
    } catch (e) {
      console.warn('[WebAuthn Delete] Failed to clear session info:', e);
    }

    return json({ 
      success: true,
      message: 'Passkey removed successfully'
    });

  } catch (error) {
    console.error('[WebAuthn Delete] Error:', error);
    return json({ 
      error: 'Failed to delete passkey' 
    }, { status: 500 });
  }
};