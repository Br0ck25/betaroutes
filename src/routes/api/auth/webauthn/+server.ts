import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateRegistrationOptions, verifyRegistrationResponse } from '$lib/server/webauthn';
import { 
  getUserAuthenticators, 
  addAuthenticator 
} from '$lib/server/authenticatorService';

// 🔧 Dynamic RP ID and Origin based on environment
function getRpID(context: { url: URL }): string {
  const hostname = context.url.hostname;
  console.log('[WebAuthn] Hostname:', hostname);
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

function getOrigin(request: Request): string {
  const url = new URL(request.url);
  console.log('[WebAuthn] Origin:', url.origin);
  return url.origin;
}

// GET: Generate registration options
export const GET: RequestHandler = async ({ url, locals, cookies, platform }) => {
  try {
    const type = url.searchParams.get('type');
    console.log('[WebAuthn] GET request - Type:', type);
    
    if (type !== 'register') {
      console.error('[WebAuthn] Invalid type:', type);
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const user = locals.user;
    if (!user || !user.email) {
      console.error('[WebAuthn] No authenticated user');
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env || !env.BETA_USERS_KV) {
      console.error('[WebAuthn] KV namespace not available');
      return json({ error: 'Service Unavailable' }, { status: 503 });
    }

    console.log('[WebAuthn] Generating options for:', user.email);

    // Get existing authenticators from KV
    const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, user.id);
    console.log('[WebAuthn] Existing authenticators:', authenticators.length);

    const userWithAuth = {
      id: user.id,
      email: user.email,
      name: user.name || user.email,
      authenticators
    };

    // Get dynamic RP ID based on environment
    const rpID = getRpID({ url });
    console.log('[WebAuthn] Using RP ID:', rpID);

    // Pass RP ID to generation function
    const options = await generateRegistrationOptions(userWithAuth, rpID);
    
    if (!options || !options.challenge) {
      console.error('[WebAuthn] Failed to generate options or missing challenge');
      return json({ error: 'Failed to generate options' }, { status: 500 });
    }

    console.log('[WebAuthn] Options generated successfully');
    console.log('[WebAuthn] Challenge length:', options.challenge.length);
    console.log('[WebAuthn] Challenge (first 20 chars):', options.challenge.substring(0, 20));

    // Store challenge in cookie
    cookies.set('webauthn-challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 300
    });

    console.log('[WebAuthn] Challenge stored in cookie');

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
  console.log('========== POST REQUEST RECEIVED ==========');
  console.log('[WebAuthn] Raw request URL:', request.url);
  
  try {
    const type = new URL(request.url).searchParams.get('type');
    console.log('[WebAuthn] POST request - Type:', type);
    
    if (type !== 'register') {
      console.error('[WebAuthn] Invalid type:', type);
      return json({ error: 'Invalid request type' }, { status: 400 });
    }

    const user = locals.user;
    if (!user || !user.email) {
      console.error('[WebAuthn] No authenticated user');
      return json({ error: 'Not authenticated' }, { status: 401 });
    }

    const env = platform?.env;
    if (!env || !env.BETA_USERS_KV) {
      console.error('[WebAuthn] KV namespace not available');
      return json({ error: 'Service Unavailable' }, { status: 503 });
    }

    console.log('[WebAuthn] Verifying registration for:', user.email);

    // Retrieve challenge from cookie
    const expectedChallenge = cookies.get('webauthn-challenge');
    
    console.log('[WebAuthn] Looking for challenge cookie...');
    console.log('[WebAuthn] All cookies:', Object.keys(cookies.getAll()));
    
    if (!expectedChallenge) {
      console.error('[WebAuthn] No challenge found in cookies');
      return json({ 
        error: 'Challenge expired or not found. Please try again.',
        hint: 'The registration process must be completed within 5 minutes.'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Challenge retrieved from cookie ✅');
    console.log('[WebAuthn] Challenge length:', expectedChallenge.length);
    console.log('[WebAuthn] Challenge (first 20 chars):', expectedChallenge.substring(0, 20));

    // Get credential from request body
    console.log('[WebAuthn] Reading request body...');
    const credential = await request.json();
    console.log('[WebAuthn] Credential received');
    console.log('[WebAuthn] Credential ID:', credential.id);
    console.log('[WebAuthn] Credential type:', credential.type);

    // Get origin and rpID dynamically
    const expectedOrigin = getOrigin(request);
    const expectedRPID = getRpID({ url: new URL(request.url) });

    console.log('[WebAuthn] Expected origin:', expectedOrigin);
    console.log('[WebAuthn] Expected RP ID:', expectedRPID);

    // Verify the registration response
    console.log('[WebAuthn] Starting verification...');
    
    const verification = await verifyRegistrationResponse(
      credential,
      expectedChallenge,
      expectedOrigin,
      expectedRPID
    );

    console.log('[WebAuthn] Verification result:', verification.verified);

    if (!verification.verified || !verification.registrationInfo) {
      console.error('[WebAuthn] Verification failed');
      return json({ 
        error: 'Verification failed',
        details: 'The credential could not be verified. Please try again.'
      }, { status: 400 });
    }

    console.log('[WebAuthn] Verification successful! ✅');

    // Extract registration info - handles different SimpleWebAuthn versions
    const registrationInfo = verification.registrationInfo;
    
    console.log('[WebAuthn] Full registration info:', JSON.stringify(registrationInfo, null, 2));

    // Try different property access patterns for different SimpleWebAuthn versions
    const credentialID = registrationInfo.credential?.id || registrationInfo.credentialID;
    const credentialPublicKey = registrationInfo.credential?.publicKey || registrationInfo.credentialPublicKey;
    const counter = registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;

    console.log('[WebAuthn] Extracted values:');
    console.log('[WebAuthn] Credential ID type:', typeof credentialID);
    console.log('[WebAuthn] Credential ID:', credentialID ? 'Present' : 'Missing');
    console.log('[WebAuthn] Public key type:', typeof credentialPublicKey);
    console.log('[WebAuthn] Public key:', credentialPublicKey ? 'Present' : 'Missing');
    console.log('[WebAuthn] Counter:', counter);

    if (!credentialID || !credentialPublicKey) {
      console.error('[WebAuthn] Missing required credential data');
      return json({ 
        error: 'Invalid credential data',
        details: 'Missing credentialID or credentialPublicKey'
      }, { status: 400 });
    }

    // Save the authenticator to KV
    console.log('[WebAuthn] Saving authenticator to KV...');

    await addAuthenticator(env.BETA_USERS_KV, user.id, {
      credentialID: Buffer.from(credentialID).toString('base64url'),
      credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
      counter: counter,
      transports: credential.response.transports || []
    });

    console.log('[WebAuthn] Saved to KV! ✅');

    // Clear the challenge cookie
    cookies.delete('webauthn-challenge', { path: '/' });
    console.log('[WebAuthn] Challenge cookie cleared');

    return json({ 
      success: true,
      verified: true,
      message: 'Passkey registered successfully!'
    });

  } catch (error) {
    console.error('[WebAuthn] POST Error:', error);
    
    if (error instanceof Error) {
      console.error('[WebAuthn] Error name:', error.name);
      console.error('[WebAuthn] Error message:', error.message);
      console.error('[WebAuthn] Error stack:', error.stack);
      
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