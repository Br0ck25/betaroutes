// src/routes/api/auth/webauthn/+server.ts - FIXED VERSION
import { json } from '@sveltejs/kit';
import {
  getRegistrationOptions,
  verifyRegistration,
  getLoginOptions,
  verifyLogin
} from '$lib/server/webauthn';
import {
  findUserByCredentialId,
  findUserById,
  saveAuthenticator,
  type Authenticator
} from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';
import { Buffer } from 'node:buffer';

// ------------------------------------
// Helpers
// ------------------------------------

function getRpID(request: Request) {
  const hostname = new URL(request.url).hostname;
  
  // 🔧 FIX 1: Support both production and development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'gorouteyourself.com';
}

function getOrigin(request: Request) {
  const url = new URL(request.url);
  
  // 🔧 FIX 2: Use actual request origin instead of hardcoded value
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return `http://localhost:${url.port || '5173'}`;
  }
  return 'https://gorouteyourself.com';
}

function setChallenge(cookies: any, challenge: string) {
  cookies.set('webauthn_challenge', challenge, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 5, // 5 minutes
  });
  console.log('[WebAuthn] Challenge set:', challenge.substring(0, 20) + '...');
}

function clearChallenge(cookies: any) {
  cookies.delete('webauthn_challenge', { path: '/' });
  console.log('[WebAuthn] Challenge cleared');
}

// ------------------------------------
// GET (options)
// ------------------------------------

export async function GET({ url, request, cookies, locals, platform }) {
  try {
    const type = url.searchParams.get('type');
    const rpID = getRpID(request);

    console.log('[WebAuthn GET] Type:', type);
    console.log('[WebAuthn GET] RP ID:', rpID);

    if (type === 'register') {
      if (!locals.user) {
        console.error('[WebAuthn GET] Unauthorized - no user in session');
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      // 🔧 FIX 3: Fetch full user with authenticators
      const kv = platform?.env?.BETA_USERS_KV;
      if (!kv) {
        console.error('[WebAuthn GET] KV not available');
        return json({ error: 'Service unavailable' }, { status: 503 });
      }

      const fullUser = await findUserById(kv, locals.user.id);
      if (!fullUser) {
        console.error('[WebAuthn GET] User not found:', locals.user.id);
        return json({ error: 'User not found' }, { status: 404 });
      }

      const options = await getRegistrationOptions(fullUser, rpID);
      setChallenge(cookies, options.challenge);
      
      console.log('[WebAuthn GET] Registration options generated successfully');
      return json(options);
    }

    // Login options
    const options = await getLoginOptions(rpID);
    setChallenge(cookies, options.challenge);
    
    console.log('[WebAuthn GET] Login options generated successfully');
    return json(options);

  } catch (e: any) {
    console.error('[WebAuthn GET] Error:', e);
    return json(
      { error: e.message || 'Failed to generate WebAuthn options' },
      { status: 500 }
    );
  }
}

// ------------------------------------
// POST (verify)
// ------------------------------------

export async function POST({ request, cookies, platform, locals }) {
  let body;
  
  try {
    body = await request.json();
  } catch (e) {
    console.error('[WebAuthn POST] Invalid JSON body');
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const challenge = cookies.get('webauthn_challenge');
  console.log('[WebAuthn POST] Challenge from cookie:', challenge?.substring(0, 20) + '...' || 'MISSING');

  if (!challenge) {
    console.error('[WebAuthn POST] Missing challenge cookie');
    return json({ 
      error: 'Missing WebAuthn challenge. Please try again.' 
    }, { status: 400 });
  }

  const rpID = getRpID(request);
  const origin = getOrigin(request);
  const type = new URL(request.url).searchParams.get('type');

  console.log('[WebAuthn POST] Type:', type);
  console.log('[WebAuthn POST] RP ID:', rpID);
  console.log('[WebAuthn POST] Origin:', origin);

  try {
    // -----------------------------
    // REGISTER
    // -----------------------------
    if (type === 'register') {
      if (!locals.user) {
        console.error('[WebAuthn POST] Unauthorized - no user');
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      console.log('[WebAuthn POST] Registering passkey for user:', locals.user.id);

      // 🔧 FIX 4: Better error messages
      const verification = await verifyRegistration(
        body,
        challenge,
        rpID,
        origin,
        locals.user.id
      );

      if (!verification.verified || !verification.registrationInfo) {
        console.error('[WebAuthn POST] Registration verification failed');
        console.error('[WebAuthn POST] Verification:', verification);
        throw new Error('Registration verification failed. Please try again.');
      }

      const { credentialID, credentialPublicKey, counter } =
        verification.registrationInfo;

      const authenticator: Authenticator = {
        credentialID: Buffer.from(credentialID).toString('base64url'),
        credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
        transports: body.response?.transports ?? [],
      };

      console.log('[WebAuthn POST] Saving authenticator...');

      const kv = platform?.env?.BETA_USERS_KV;
      if (!kv) {
        throw new Error('Service unavailable');
      }

      await saveAuthenticator(kv, locals.user.id, authenticator);

      clearChallenge(cookies);
      console.log('[WebAuthn POST] Registration successful!');
      
      return json({ 
        verified: true,
        message: 'Passkey registered successfully!' 
      });
    }

    // -----------------------------
    // LOGIN
    // -----------------------------
    const credentialID = body.id;

    if (!credentialID) {
      console.error('[WebAuthn POST] Missing credential ID in login request');
      return json({ error: 'Invalid request' }, { status: 400 });
    }

    console.log('[WebAuthn POST] Logging in with credential:', credentialID.substring(0, 20) + '...');

    const kv = platform?.env?.BETA_USERS_KV;
    if (!kv) {
      throw new Error('Service unavailable');
    }

    const user = await findUserByCredentialId(kv, credentialID);

    if (!user || !user.authenticators) {
      console.error('[WebAuthn POST] User not found for credential');
      return json({ error: 'User not found' }, { status: 400 });
    }

    const authenticator = user.authenticators.find(
      a => a.credentialID === credentialID
    );

    if (!authenticator) {
      console.error('[WebAuthn POST] Authenticator not found');
      return json({ error: 'Authenticator not found' }, { status: 400 });
    }

    console.log('[WebAuthn POST] Found authenticator, verifying...');

    const verification = await verifyLogin(
      body,
      challenge,
      {
        id: credentialID,
        publicKey: Buffer.from(authenticator.credentialPublicKey, 'base64url'),
        counter: authenticator.counter,
      },
      rpID,
      origin
    );

    if (!verification.verified) {
      console.error('[WebAuthn POST] Authentication verification failed');
      throw new Error('Authentication failed');
    }

    console.log('[WebAuthn POST] Creating session...');

    const sessionsKV = platform?.env?.BETA_SESSIONS_KV;
    if (!sessionsKV) {
      throw new Error('Service unavailable');
    }

    const sessionId = await createSession(sessionsKV, {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name
    });

    cookies.set('session_id', sessionId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    clearChallenge(cookies);
    console.log('[WebAuthn POST] Login successful!');
    
    return json({ 
      verified: true,
      message: 'Logged in successfully!' 
    });

  } catch (e: any) {
    console.error('[WebAuthn POST] Error:', e);
    console.error('[WebAuthn POST] Stack:', e.stack);
    
    clearChallenge(cookies);
    
    // 🔧 FIX 5: More helpful error messages
    let errorMessage = 'WebAuthn verification failed';
    
    if (e.message?.includes('challenge')) {
      errorMessage = 'Security challenge expired. Please try again.';
    } else if (e.message?.includes('origin')) {
      errorMessage = 'Origin verification failed. Please contact support.';
    } else if (e.message) {
      errorMessage = e.message;
    }
    
    return json(
      { error: errorMessage },
      { status: 400 }
    );
  }
}