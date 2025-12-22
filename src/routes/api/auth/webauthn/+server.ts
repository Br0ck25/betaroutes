import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { 
  generateRegistrationOptions, 
  verifyRegistrationResponse,
  generateAuthenticationOptionsForUser,
  verifyAuthenticationResponseForUser
} from '$lib/server/webauthn';
import { 
  getUserAuthenticators, 
  addAuthenticator,
  updateAuthenticatorCounter
} from '$lib/server/authenticatorService';

// Helper to get RP ID
function getRpID(context: { url: URL }): string {
  const hostname = context.url.hostname;
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

// Helper to get origin
function getOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// GET: Generate options (registration OR authentication)
export const GET: RequestHandler = async ({ url, locals, cookies, platform }) => {
  try {
    const type = url.searchParams.get('type');
    
    // REGISTRATION
    if (type === 'register') {
      console.log('[WebAuthn] GET - Registration');
      
      const user = locals.user;
      if (!user || !user.email) {
        return json({ error: 'Not authenticated' }, { status: 401 });
      }

      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, user.id);
      
      const userWithAuth = {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        authenticators
      };

      const rpID = getRpID({ url });
      const options = await generateRegistrationOptions(userWithAuth, rpID);
      
      if (!options || !options.challenge) {
        return json({ error: 'Failed to generate options' }, { status: 500 });
      }

      cookies.set('webauthn-challenge', options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

      console.log('[WebAuthn] Registration options sent');
      return json(options);
    }
    
    // AUTHENTICATION (no type param or type=authenticate)
    else {
      console.log('[WebAuthn] GET - Authentication');
      
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      // For authentication, we need ALL users' authenticators
      // In production, you'd optimize this (e.g., store user ID in credential)
      // For now, we'll generate options that work with any registered passkey
      
      const rpID = getRpID({ url });
      
      // Generate authentication options without user-specific credentials
      // This allows any registered passkey to be used
      const options = await generateAuthenticationOptionsForUser([], rpID);
      
      if (!options || !options.challenge) {
        return json({ error: 'Failed to generate options' }, { status: 500 });
      }

      cookies.set('webauthn-challenge', options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

      console.log('[WebAuthn] Authentication options sent');
      return json(options);
    }
    
  } catch (error) {
    console.error('[WebAuthn] GET Error:', error);
    return json({ 
      error: 'Failed to generate options',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};

// POST: Verify response (registration OR authentication)
export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
  try {
    const type = new URL(request.url).searchParams.get('type');
    
    // REGISTRATION VERIFICATION
    if (type === 'register') {
      console.log('[WebAuthn] POST - Registration verification');
      
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
        return json({ error: 'Challenge expired. Please try again.' }, { status: 400 });
      }

      const credential = await request.json();
      const expectedOrigin = getOrigin(request);
      const expectedRPID = getRpID({ url: new URL(request.url) });

      const verification = await verifyRegistrationResponse(
        credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID
      );

      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: 'Verification failed' }, { status: 400 });
      }

      const registrationInfo = verification.registrationInfo;
      const credentialID = registrationInfo.credential?.id || registrationInfo.credentialID;
      const credentialPublicKey = registrationInfo.credential?.publicKey || registrationInfo.credentialPublicKey;
      const counter = registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;

      if (!credentialID || !credentialPublicKey) {
        return json({ error: 'Invalid credential data' }, { status: 400 });
      }

      await addAuthenticator(env.BETA_USERS_KV, user.id, {
        credentialID: Buffer.from(credentialID).toString('base64url'),
        credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter: counter,
        transports: credential.response.transports || []
      });

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Registration successful!');
      return json({ success: true, verified: true, message: 'Passkey registered successfully!' });
    }
    
    // AUTHENTICATION VERIFICATION
    else {
      console.log('[WebAuthn] POST - Authentication verification');
      
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const expectedChallenge = cookies.get('webauthn-challenge');
      if (!expectedChallenge) {
        return json({ error: 'Challenge expired. Please try again.' }, { status: 400 });
      }

      const credential = await request.json();
      const credentialID = credential.id;
      
      console.log('[WebAuthn] Looking for credential:', credentialID);

      // Find which user owns this credential
      // In production, you'd have an index for this
      // For now, we'll search (not scalable, but works for demo)
      const userKey = await findUserByCredentialID(env.BETA_USERS_KV, credentialID);
      
      if (!userKey) {
        console.error('[WebAuthn] Credential not found');
        return json({ error: 'Passkey not found' }, { status: 404 });
      }

      console.log('[WebAuthn] Found user:', userKey);

      const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, userKey);
      const authenticator = authenticators.find(
        auth => auth.credentialID === credentialID
      );

      if (!authenticator) {
        return json({ error: 'Authenticator not found' }, { status: 404 });
      }

      const expectedOrigin = getOrigin(request);
      const expectedRPID = getRpID({ url: new URL(request.url) });

      const verification = await verifyAuthenticationResponseForUser(
        credential,
        expectedChallenge,
        authenticator,
        expectedOrigin,
        expectedRPID
      );

      if (!verification.verified) {
        return json({ error: 'Authentication failed' }, { status: 400 });
      }

      // Update counter to prevent replay attacks
      const authInfo = verification.authenticationInfo;
      const newCounter = authInfo.newCounter ?? authInfo.counter ?? authenticator.counter + 1;
      
      await updateAuthenticatorCounter(
        env.BETA_USERS_KV,
        userKey,
        credentialID,
        newCounter
      );

      // TODO: Create session for the user
      // For now, just return success
      // You'll need to integrate with your existing auth system

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Authentication successful!');
      return json({ 
        success: true, 
        verified: true,
        userId: userKey,
        message: 'Authentication successful!' 
      });
    }
    
  } catch (error) {
    console.error('[WebAuthn] POST Error:', error);
    
    if (error instanceof Error) {
      return json({ 
        error: 'Verification failed',
        details: error.message
      }, { status: 400 });
    }
    
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};

// Helper function to find user by credential ID
async function findUserByCredentialID(
  kv: KVNamespace,
  credentialID: string
): Promise<string | null> {
  // This is inefficient - in production, maintain a separate index
  // For now, we assume user IDs are stored somewhere accessible
  
  // You'll need to implement this based on your user storage
  // Option 1: Maintain a credential-to-user index
  // Option 2: Store user ID in the credential during registration
  
  // Placeholder - you need to implement based on your system
  console.log('[WebAuthn] TODO: Implement user lookup by credential ID');
  return null;
}