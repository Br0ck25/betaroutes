import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { 
  generateRegistrationOptions, 
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type { AuthenticatorTransport } from '@simplewebauthn/types';
import { 
  getUserAuthenticators, 
  addAuthenticator,
  updateAuthenticatorCounter,
  getUserIdByCredentialID
} from '$lib/server/authenticatorService';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { dev } from '$app/environment';

function getRpID(context: { url: URL }): string {
  const hostname = context.url.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

function getOrigin(request: Request): string {
  return new URL(request.url).origin;
}

// Convert ArrayBuffer/Uint8Array/Buffer-like values to base64url string safely.
function toBase64Url(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;

  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array((input as any).buffer, (input as any).byteOffset || 0, (input as any).byteLength || (input as any).length);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if ((input as any).buffer && (input as any).byteLength) {
    // fallback for exotic typed shapes
    try {
      bytes = new Uint8Array((input as any).buffer);
    } catch (e) {
      throw new Error('Unsupported input type for base64url conversion');
    }
  } else {
    throw new Error('Unsupported input type for base64url conversion');
  }

  // Convert to regular base64
  let base64: string = '';
  
  try {
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(bytes).toString('base64');
    } else if (typeof btoa !== 'undefined') {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    } else {
      throw new Error('No base64 encoding method available');
    }
  } catch (e) {
    console.error('[webauthn] Base64 encoding failed:', e);
    throw new Error('Failed to encode to base64');
  }

  if (typeof base64 !== 'string' || base64.length === 0) {
    console.error('[webauthn] toBase64Url produced invalid output:', typeof base64, base64);
    throw new Error('Failed to convert to base64 string');
  }

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Convert base64url string back to Uint8Array
function fromBase64Url(base64url: string): Uint8Array {
  if (!base64url) {
    throw new Error('Empty base64url string');
  }
  
  // Convert base64url to regular base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  
  try {
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(base64, 'base64'));
    } else if (typeof atob !== 'undefined') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } else {
      throw new Error('No base64 decoding method available');
    }
  } catch (e) {
    console.error('[webauthn] Base64 decoding failed:', e);
    throw new Error('Failed to decode base64');
  }
}

export const GET: RequestHandler = async ({ url, locals, cookies, platform }) => {
  try {
    const type = url.searchParams.get('type');
    
    if (type === 'register') {
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
      
      // Generate registration options using the library directly
      const options = await generateRegistrationOptions({
        rpName: 'Go Route Yourself',
        rpID,
        userID: new TextEncoder().encode(user.id), // CRITICAL: Must be Uint8Array
        userName: user.email,
        userDisplayName: user.name || user.email,
        attestationType: 'none',
        excludeCredentials: authenticators.map(auth => ({
          id: auth.credentialID, // Keep as string - library handles conversion
          type: 'public-key' as const,
          transports: auth.transports as AuthenticatorTransport[] | undefined
        })),
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'preferred',
          requireResidentKey: false
        },
        timeout: 60000
      });
      
      if (!options || !options.challenge) {
        return json({ error: 'Failed to generate options' }, { status: 500 });
      }

      // Convert binary fields to base64url strings for JSON serialization
      try {
        if (options.challenge && typeof options.challenge !== 'string') {
          options.challenge = toBase64Url(options.challenge);
        }

        if (Array.isArray(options.excludeCredentials)) {
          options.excludeCredentials = options.excludeCredentials.map((c: any) => {
            if (typeof c.id === 'string') return { ...c, id: c.id };
            try {
              return { ...c, id: toBase64Url(c.id) };
            } catch (err) {
              console.error('[webauthn] excludeCredential id conversion failed:', err);
              throw err;
            }
          });
        }
      } catch (convErr) {
        console.warn('[webauthn] Failed to convert registration options', convErr);
        return json({ 
          error: 'Failed to generate options', 
          details: convErr instanceof Error ? convErr.message : String(convErr)
        }, { status: 500 });
      }

      cookies.set('webauthn-challenge', String(options.challenge), {
        httpOnly: true,
        secure: !dev,
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

      return json(options);
    } else {
      // Authentication - generate options without requiring existing session
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const rpID = getRpID({ url });
      
      // For passwordless authentication, we MUST use discoverable credentials
      // Don't pass allowCredentials at all - browser will show all available passkeys
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: 'preferred',
        timeout: 60000,
      });
      
      if (!options || !options.challenge) {
        return json({ error: 'Failed to generate options' }, { status: 500 });
      }

      // Convert binary fields to base64url strings
      try {
        if (options.challenge && typeof options.challenge !== 'string') {
          options.challenge = toBase64Url(options.challenge);
        }

        if (Array.isArray(options.allowCredentials)) {
          options.allowCredentials = options.allowCredentials.map((c: any) => {
            if (typeof c.id === 'string') return { ...c, id: c.id };
            try {
              return { ...c, id: toBase64Url(c.id) };
            } catch (err) {
              console.error('[webauthn] allowCredential id conversion failed:', err);
              throw err;
            }
          });
        }
      } catch (convErr) {
        console.warn('[webauthn] Failed to convert authentication options', convErr);
        return json({ 
          error: 'Failed to generate options', 
          details: convErr instanceof Error ? convErr.message : String(convErr)
        }, { status: 500 });
      }

      cookies.set('webauthn-challenge', String(options.challenge), {
        httpOnly: true,
        secure: !dev,
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });
      
      return json(options);
    }
  } catch (error) {
    console.error('[WebAuthn] GET Error:', error, error instanceof Error ? error.stack : undefined);
    return json({ 
      error: 'Failed to generate options',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
  try {
    const type = new URL(request.url).searchParams.get('type');
    
    if (type === 'register') {
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
        return json({ error: 'Challenge expired' }, { status: 400 });
      }

      const credential = await request.json();
      const expectedOrigin = getOrigin(request);
      const expectedRPID = getRpID({ url: new URL(request.url) });

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin,
        expectedRPID
      });

      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: 'Verification failed' }, { status: 400 });
      }

      const { registrationInfo } = verification;
      
      console.log('[WebAuthn] Registration info keys:', Object.keys(registrationInfo));
      console.log('[WebAuthn] Credential from browser - ID:', credential.id);
      
      // CRITICAL: Use credential.id from browser (already base64url)
      // This ensures exact match during authentication  
      const storedCredentialID = credential.id;
      
      // Get public key from registrationInfo.credential.publicKey
      // It's returned as an object with numeric indices, convert to Uint8Array
      const credentialPublicKeyObj = registrationInfo.credential?.publicKey;
      const counter = registrationInfo.credential?.counter ?? 0;

      console.log('[WebAuthn] Credential ID:', storedCredentialID);
      console.log('[WebAuthn] credential.publicKey type:', typeof credentialPublicKeyObj);
      console.log('[WebAuthn] credential.publicKey exists?', !!credentialPublicKeyObj);
      console.log('[WebAuthn] Counter:', counter);
      
      if (!storedCredentialID) {
        console.error('[WebAuthn] Missing credential ID from browser');
        return json({ error: 'Invalid credential ID' }, { status: 400 });
      }
      
      if (!credentialPublicKeyObj) {
        console.error('[WebAuthn] Missing publicKey from registrationInfo.credential');
        console.error('[WebAuthn] Available credential fields:', Object.keys(registrationInfo.credential || {}));
        return json({ error: 'Invalid credential public key - not found in credential object' }, { status: 400 });
      }
      
      // Convert object with numeric indices to Uint8Array
      let credentialPublicKey: Uint8Array;
      try {
        const length = Object.keys(credentialPublicKeyObj).length;
        credentialPublicKey = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          credentialPublicKey[i] = (credentialPublicKeyObj as any)[i];
        }
        console.log('[WebAuthn] Converted publicKey to Uint8Array, length:', credentialPublicKey.length);
      } catch (e) {
        console.error('[WebAuthn] Failed to convert publicKey to Uint8Array:', e);
        return json({ error: 'Failed to convert public key' }, { status: 400 });
      }

      let storedPublicKey: string;
      try {
        // Convert Uint8Array public key to base64url string for storage
        storedPublicKey = toBase64Url(credentialPublicKey);
        console.log('[WebAuthn] Converted public key to base64url, length:', storedPublicKey.length);
      } catch (e) {
        console.error('[WebAuthn] Failed to convert public key to base64url:', e);
        return json({ error: 'Failed to process credential public key' }, { status: 400 });
      }

      console.log('[WebAuthn] Storing credential ID (from browser):', storedCredentialID);
      console.log('[WebAuthn] Will create index:', `credential:${storedCredentialID}`, '→', user.id);

      await addAuthenticator(env.BETA_USERS_KV, user.id, {
        credentialID: storedCredentialID,
        credentialPublicKey: storedPublicKey,
        counter: counter,
        transports: credential.response.transports || []
      });

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Registration complete! Credential ID:', storedCredentialID);
      return json({ 
        success: true, 
        verified: true, 
        message: 'Passkey registered!',
        credentialID: storedCredentialID // Return for debugging
      });
    } else {
      // AUTHENTICATION FLOW
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const sessionKv = env?.BETA_SESSIONS_KV;
      if (!sessionKv) {
        return json({ error: 'Session service unavailable' }, { status: 503 });
      }

      const expectedChallenge = cookies.get('webauthn-challenge');
      if (!expectedChallenge) {
        return json({ error: 'Challenge expired' }, { status: 400 });
      }

      const credential = await request.json();
      
      // Browser sends credential.id as base64url string - use directly
      const credentialID = credential.id;
      
      if (!credentialID || typeof credentialID !== 'string') {
        console.error('[WebAuthn Auth] Invalid credential ID:', credentialID);
        return json({ error: 'Invalid credential ID' }, { status: 400 });
      }

      console.log('[WebAuthn Auth] Received credential ID:', credentialID);
      console.log('[WebAuthn Auth] Index key:', `credential:${credentialID}`);

      const userId = await getUserIdByCredentialID(env.BETA_USERS_KV, credentialID);
      
      if (!userId) {
        console.error('[WebAuthn] Credential not found in index');
        return json({ error: 'Passkey not found' }, { status: 404 });
      }

      console.log('[WebAuthn] Found user:', userId);

      const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, userId);
      console.log('[WebAuthn] User has', authenticators.length, 'authenticators');
      
      const authenticator = authenticators.find(auth => auth.credentialID === credentialID);

      if (!authenticator) {
        console.error('[WebAuthn] Authenticator not in user list');
        return json({ error: 'Authenticator not found' }, { status: 404 });
      }
      
      console.log('[WebAuthn] Found authenticator, keys:', Object.keys(authenticator));
      console.log('[WebAuthn] Authenticator structure:', {
        hasCredentialID: !!authenticator.credentialID,
        credentialPublicKey: typeof authenticator.credentialPublicKey,
        credentialPublicKeyLength: authenticator.credentialPublicKey?.length,
        hasCounter: 'counter' in authenticator,
        counter: authenticator.counter,
        hasTransports: !!authenticator.transports
      });

      const expectedOrigin = getOrigin(request);
      const expectedRPID = getRpID({ url: new URL(request.url) });

      // Convert stored base64url public key back to Uint8Array
      let credentialPublicKeyBytes: Uint8Array;
      try {
        if (!authenticator.credentialPublicKey || typeof authenticator.credentialPublicKey !== 'string') {
          console.error('[WebAuthn] Invalid credentialPublicKey type:', typeof authenticator.credentialPublicKey);
          return json({ error: 'Invalid stored public key format' }, { status: 500 });
        }
        
        credentialPublicKeyBytes = fromBase64Url(authenticator.credentialPublicKey);
        console.log('[WebAuthn] Converted public key back to Uint8Array, length:', credentialPublicKeyBytes.length);
      } catch (e) {
        console.error('[WebAuthn] Failed to convert public key from base64url:', e);
        console.error('[WebAuthn] Public key value:', authenticator.credentialPublicKey);
        return json({ error: 'Invalid stored public key' }, { status: 500 });
      }

      // Prepare authenticator data for verification
      const authData = {
        credentialID: authenticator.credentialID,
        credentialPublicKey: credentialPublicKeyBytes,  // Use Uint8Array
        counter: typeof authenticator.counter === 'number' ? authenticator.counter : 0
      };
      
      console.log('[WebAuthn] Auth data prepared:', {
        credentialID: authData.credentialID,
        publicKeyLength: authData.credentialPublicKey.length,
        counter: authData.counter
      });

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge,
          expectedOrigin,
          expectedRPID,
          authenticator: authData
        });
      } catch (e) {
        console.error('[WebAuthn] Verification threw error:', e);
        console.error('[WebAuthn] Error stack:', e instanceof Error ? e.stack : 'N/A');
        return json({ error: 'Verification failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
      }

      if (!verification.verified) {
        console.error('[WebAuthn] Verification failed - not verified');
        return json({ error: 'Authentication failed' }, { status: 400 });
      }

      console.log('[WebAuthn] Verification successful!');
      console.log('[WebAuthn] authenticationInfo keys:', Object.keys(verification.authenticationInfo || {}));

      const authInfo = verification.authenticationInfo;
      const newCounter = authInfo?.newCounter ?? authInfo?.counter ?? (authData.counter + 1);
      
      console.log('[WebAuthn] Updating counter from', authData.counter, 'to', newCounter);
      
      await updateAuthenticatorCounter(env.BETA_USERS_KV, userId, credentialID, newCounter);

      // ✅ CREATE SESSION - just like password login does!
      const fullUser = await findUserById(env.BETA_USERS_KV, userId);
      const now = new Date().toISOString();
      
      const sessionData = {
        id: userId,
        name: fullUser?.name || fullUser?.username || 'User',
        email: fullUser?.email || '',
        plan: fullUser?.plan || 'free',
        tripsThisMonth: fullUser?.tripsThisMonth || 0,
        maxTrips: fullUser?.maxTrips || 10,
        resetDate: fullUser?.resetDate || now,
        role: (fullUser as any)?.role || 'user'
      };

      const sessionId = await createSession(sessionKv, sessionData);
      
      cookies.set('session_id', sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !dev,
        maxAge: 60 * 60 * 24 * 7
      });

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Authentication successful! Session created.');
      return json({ 
        success: true, 
        verified: true,
        user: sessionData,
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
    
    return json({ error: 'Unexpected error' }, { status: 500 });
  }
};