import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserAuthenticators } from '$lib/server/authenticatorService';

export const GET: RequestHandler = async ({ platform, locals }) => {
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

    // Get user's authenticators
    const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, session.id);

    // Return sanitized list (don't expose the public key)
    const sanitized = authenticators.map(auth => ({
      credentialID: auth.credentialID,
      transports: auth.transports || [],
      // You could add createdAt if you store it
    }));

    return json({ 
      success: true, 
      authenticators: sanitized 
    });

  } catch (error) {
    console.error('[WebAuthn List] Error:', error);
    return json({ 
      error: 'Failed to retrieve passkeys' 
    }, { status: 500 });
  }
};