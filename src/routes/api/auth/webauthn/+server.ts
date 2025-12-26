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
      const options = await generateRegistrationOptions(userWithAuth, rpID);
      
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
      const options = await generateAuthenticationOptionsForUser([], rpID);
      
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

      let storedCredentialID: string;
      let storedPublicKey: string;
      try {
        storedCredentialID = typeof credentialID === 'string' ? credentialID : toBase64Url(credentialID);
      } catch (e) {
        console.error('[WebAuthn] Failed to normalize credential ID:', e);
        return json({ error: 'Invalid credential ID' }, { status: 400 });
      }

      try {
        storedPublicKey = typeof credentialPublicKey === 'string' ? credentialPublicKey : toBase64Url(credentialPublicKey);
      } catch (e) {
        console.error('[WebAuthn] Failed to normalize credential public key:', e);
        return json({ error: 'Invalid credential public key' }, { status: 400 });
      }

      await addAuthenticator(env.BETA_USERS_KV, user.id, {
        credentialID: storedCredentialID,
        credentialPublicKey: storedPublicKey,
        counter: counter,
        transports: credential.response.transports || []
      });

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Registration complete!');
      return json({ success: true, verified: true, message: 'Passkey registered!' });
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
      const rawCredentialID = credential.id;

      let credentialID: string;
      try {
        credentialID = typeof rawCredentialID === 'string' ? rawCredentialID : toBase64Url(rawCredentialID);
      } catch (e) {
        console.error('[WebAuthn] Invalid credential id in request:', e);
        return json({ error: 'Invalid credential id' }, { status: 400 });
      }

      console.log('[WebAuthn] Looking up credential:', credentialID);

      const userId = await getUserIdByCredentialID(env.BETA_USERS_KV, credentialID);
      
      if (!userId) {
        console.error('[WebAuthn] Credential not found in index');
        return json({ error: 'Passkey not found' }, { status: 404 });
      }

      console.log('[WebAuthn] Found user:', userId);

      const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, userId);
      const authenticator = authenticators.find(auth => auth.credentialID === credentialID);

      if (!authenticator) {
        console.error('[WebAuthn] Authenticator not in user list');
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
        console.error('[WebAuthn] Verification failed');
        return json({ error: 'Authentication failed' }, { status: 400 });
      }

      const authInfo = verification.authenticationInfo;
      const newCounter = authInfo.newCounter ?? authInfo.counter ?? authenticator.counter + 1;
      
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