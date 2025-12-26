import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeAuthenticator } from '$lib/server/authenticatorService';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  try {
    // Check if user is authenticated
    const session = locals.session;
    if (!session?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env?.BETA_USERS_KV) {
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