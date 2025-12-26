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
import { isoBase64URL } from '@simplewebauthn/server/helpers';

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
function toBase64Url(input: any) {
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
  let base64: string;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else if (typeof btoa !== 'undefined') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  } else {
    // Last resort: manual conversion
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
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

      // Convert binary fields to base64url strings for JSON serialization with per-field diagnostics
      function fieldInfo(val: any) {
        try {
          return {
            type: typeof val,
            ctor: val && (val.constructor ? val.constructor.name : undefined),
            length: (val && (val.byteLength || val.length)) || undefined
          };
        } catch (e) {
          return { type: typeof val };
        }
      }

      try {
        console.log('[webauthn] Pre-conversion challenge info:', fieldInfo(options.challenge));
        if (options.challenge && typeof options.challenge !== 'string') {
          try {
            options.challenge = toBase64Url(options.challenge);
            console.log('[webauthn] Converted challenge to base64url (len):', String(options.challenge).length);
          } catch (err) {
            console.error('[webauthn] Challenge conversion failed:', err);
            return json({ error: 'Failed to generate options', details: err instanceof Error ? err.message : String(err), stack: process.env.NODE_ENV !== 'production' ? (err instanceof Error ? err.stack : undefined) : undefined }, { status: 500 });
          }
        }

        if (Array.isArray(options.excludeCredentials)) {
          const idsInfo = options.excludeCredentials.map((c: any) => ({ idInfo: fieldInfo(c.id) }));
          console.log('[webauthn] Pre-conversion excludeCredentials ids info:', idsInfo);

          options.excludeCredentials = options.excludeCredentials.map((c: any) => {
            if (typeof c.id === 'string') return { ...c, id: c.id };
            try {
              return { ...c, id: toBase64Url(c.id) };
            } catch (err) {
              console.error('[webauthn] excludeCredential id conversion failed for one credential:', err);
              throw err;
            }
          });
        }
      } catch (convErr) {
        console.warn('[webauthn] Failed to convert registration options binary fields', convErr);
        return json({ error: 'Failed to generate options', details: convErr instanceof Error ? convErr.message : String(convErr), stack: process.env.NODE_ENV !== 'production' ? (convErr instanceof Error ? convErr.stack : undefined) : undefined }, { status: 500 });
      }

      cookies.set('webauthn-challenge', String(options.challenge), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

      // Log the exact JSON we're about to send to the client to aid debugging
      try {
        console.log('[webauthn] Registration options payload:', JSON.stringify(options));
      } catch (logErr) {
        console.warn('[webauthn] Failed to stringify registration options for logging', logErr);
      }

      return json(options);
    } else {
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const rpID = getRpID({ url });
      const options = await generateAuthenticationOptionsForUser([], rpID);
      
      if (!options || !options.challenge) {
        return json({ error: 'Failed to generate options' }, { status: 500 });
      }

      // Convert binary fields to base64url strings for JSON serialization (auth), with diagnostics
      try {
        function fieldInfo(val: any) {
          try {
            return { type: typeof val, ctor: val && (val.constructor ? val.constructor.name : undefined), length: (val && (val.byteLength || val.length)) || undefined };
          } catch (e) {
            return { type: typeof val };
          }
        }

        console.log('[webauthn] Pre-conversion auth challenge info:', fieldInfo(options.challenge));
        if (options.challenge && typeof options.challenge !== 'string') {
          try {
            options.challenge = toBase64Url(options.challenge);
            console.log('[webauthn] Converted auth challenge to base64url (len):', String(options.challenge).length);
          } catch (err) {
            console.error('[webauthn] Auth challenge conversion failed:', err);
            return json({ error: 'Failed to generate options', details: err instanceof Error ? err.message : String(err), stack: process.env.NODE_ENV !== 'production' ? (err instanceof Error ? err.stack : undefined) : undefined }, { status: 500 });
          }
        }

        if (Array.isArray(options.allowCredentials)) {
          const idsInfo = options.allowCredentials.map((c: any) => ({ idInfo: fieldInfo(c.id) }));
          console.log('[webauthn] Pre-conversion allowCredentials ids info:', idsInfo);

          options.allowCredentials = options.allowCredentials.map((c: any) => {
            if (typeof c.id === 'string') return { ...c, id: c.id };
            try {
              return { ...c, id: toBase64Url(c.id) };
            } catch (err) {
              console.error('[webauthn] allowCredential id conversion failed for one credential:', err);
              throw err;
            }
          });
        }
      } catch (convErr) {
        console.warn('[webauthn] Failed to convert authentication options binary fields', convErr);
        return json({ error: 'Failed to generate options', details: convErr instanceof Error ? convErr.message : String(convErr), stack: process.env.NODE_ENV !== 'production' ? (convErr instanceof Error ? convErr.stack : undefined) : undefined }, { status: 500 });
      }

      cookies.set('webauthn-challenge', String(options.challenge), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
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
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: process.env.NODE_ENV !== 'production' ? (error instanceof Error ? error.stack : undefined) : undefined
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

      console.log('[WebAuthn] Saving authenticator...');
      console.log('[WebAuthn] Credential ID type:', typeof credentialID);
      console.log('[WebAuthn] Public key type:', typeof credentialPublicKey);

      // Use isoBase64URL.fromBuffer for Cloudflare Workers compatibility
      await addAuthenticator(env.BETA_USERS_KV, user.id, {
        credentialID: isoBase64URL.fromBuffer(credentialID),
        credentialPublicKey: isoBase64URL.fromBuffer(credentialPublicKey),
        counter: counter,
        transports: credential.response.transports || []
      });

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Registration complete!');
      return json({ success: true, verified: true, message: 'Passkey registered!' });
    } else {
      const env = platform?.env;
      if (!env || !env.BETA_USERS_KV) {
        return json({ error: 'Service Unavailable' }, { status: 503 });
      }

      const expectedChallenge = cookies.get('webauthn-challenge');
      if (!expectedChallenge) {
        return json({ error: 'Challenge expired' }, { status: 400 });
      }

      const credential = await request.json();
      const credentialID = credential.id;

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

      cookies.delete('webauthn-challenge', { path: '/' });

      console.log('[WebAuthn] Authentication successful!');
      return json({ 
        success: true, 
        verified: true,
        userId: userId,
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