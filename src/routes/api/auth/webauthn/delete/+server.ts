import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeAuthenticator } from '$lib/server/authenticatorService';
import { safeKV } from '$lib/server/env';

export const POST: RequestHandler = async ({ request, platform, locals, cookies }) => {
  try {
    // Check if user is authenticated
    const user = locals.user as any;
    if (!user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const env = platform?.env as any;
    if (!safeKV(env, 'BETA_USERS_KV') || !safeKV(env, 'BETA_SESSIONS_KV')) {
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    const usersKV = safeKV(env, 'BETA_USERS_KV')!;
    const sessionsKV = safeKV(env, 'BETA_SESSIONS_KV')!;

    // Get the credential ID to delete
    const body: any = await request.json();
    const { credentialID } = body;

    if (!credentialID || typeof credentialID !== 'string') {
      return json({ error: 'Invalid credential ID' }, { status: 400 });
    }

    // Remove the authenticator
    await removeAuthenticator(usersKV as any, user.id, credentialID);

    // If this credential was used to create the current session, remove it from session KV
    try {
      const sessionId = cookies.get('session_id');
      if (sessionId) {
        const sessionStr = await sessionsKV.get(sessionId);
        if (sessionStr) {
          const sessionObj = JSON.parse(sessionStr);
          if (sessionObj.lastUsedCredentialID && sessionObj.lastUsedCredentialID === credentialID) {
            delete sessionObj.lastUsedCredentialID;
            await sessionsKV.put(sessionId, JSON.stringify(sessionObj));
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