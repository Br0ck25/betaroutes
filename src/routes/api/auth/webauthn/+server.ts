// src/routes/api/auth/webauthn/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateRegistrationOptions, verifyRegistrationResponse } from '$lib/server/webauthn';
import { 
  getUserAuthenticators, 
  addAuthenticator 
} from '$lib/server/authenticatorService';

// 🔧 Dynamic RP ID and Origin based on environment
function getRpID(request: Request): string {
  const hostname = new URL(request.url).hostname;
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

function getOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// GET: Generate registration options
export const GET: RequestHandler = async ({ url, locals, cookies, platform }) => {
  try {
    const type = url.searchParams.get('type');
    
    if (type !== 'register') {
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const user = locals.user;
    if (!user || !user.email) {
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env || !env.BETA_USERS_KV) {
      return json({ error: 'Service Unavailable' }, { status: 503 });
    }

    console.log('[WebAuthn] Generating options for:', user.email);

    // Get existing authenticators from KV
    const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, user.id);
    
    const userWithAuth = {
      id: user.id,
      email: user.email,
      name: user.name || user.email,
      authenticators
    };

    const options = await generateRegistrationOptions(userWithAuth);
    
    if (!options || !options.challenge) {
      return json({ error: 'Failed to generate options' }, { status: 500 });
    }

    console.log('[WebAuthn] Challenge stored in cookie');

    cookies.set('webauthn-challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 300
    });

    return json(options);
  } catch (error) {
    console.error('[WebAuthn] GET Error:', error);
    return json({ 
      error: 'Failed to generate registration options',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};

// POST: Verify registration response
export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
  try {
    const type = new URL(request.url).searchParams.get('type');
    
    if (type !== 'register') {
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const user = locals.user;
    if (!user || !user.email) {
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env || !env.BETA_USERS_KV) {
      return json({ error: 'Service Unavailable' }, { status: 503 });
    }

    const expectedChallenge = cookies.get('webauthn-challenge');
    
    if (!expectedChallenge) {
      console.error('[WebAuthn] No challenge found');
      return json({ 
        error: 'Challenge expired or not found. Please try again.'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Challenge retrieved from cookie ✅');

    const credential = await request.json();
    
    const expectedOrigin = getOrigin(request);
    const expectedRPID = getRpID(request);

    console.log('[WebAuthn] Starting verification...');
    
    const verification = await verifyRegistrationResponse(
      credential,
      expectedChallenge,
      expectedOrigin,
      expectedRPID
    );

    if (!verification.verified || !verification.registrationInfo) {
      return json({ 
        error: 'Verification failed'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Verification successful! ✅');

    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;
    
    await addAuthenticator(env.BETA_USERS_KV, user.id, {
      credentialID: Buffer.from(credentialID).toString('base64url'),
      credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
      counter: counter,
      transports: credential.response.transports || []
    });

    console.log('[WebAuthn] Saved to KV! ✅');

    cookies.delete('webauthn-challenge', { path: '/' });

    return json({ 
      success: true,
      verified: true,
      message: 'Passkey registered successfully!'
    });

  } catch (error) {
    console.error('[WebAuthn] POST Error:', error);
    
    if (error instanceof Error) {
      return json({ 
        error: 'Registration failed',
        details: error.message
      }, { status: 400 });
    }
    
    return json({ 
      error: 'An unexpected error occurred'
    }, { status: 500 });
  }
};