import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserAuthenticators } from '$lib/server/authenticatorService';

export const GET: RequestHandler = async ({ platform, locals, cookies }) => {
  try {
    // Check if user is authenticated
    const user = locals.user;
    if (!user?.id) {
      // Log cookie value to help debug session mismatches in production
      try {
        const cookieVal = cookies.get('session_id');
        console.debug('[WebAuthn List] Unauthorized request; session_id cookie:', cookieVal ? 'present' : 'missing');
      } catch (e) {
        // ignore
      }
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env?.BETA_USERS_KV) {
      return json({ error: 'Service unavailable' }, { status: 503 });
    }

    // Get user's authenticators
    const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, user.id);

    // Return sanitized list (don't expose the public key)
    const sanitized = authenticators.map(auth => ({
      credentialID: auth.credentialID,
      transports: auth.transports || [],
      name: auth.name || null,
      createdAt: auth.createdAt || null
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