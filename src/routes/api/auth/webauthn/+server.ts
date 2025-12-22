import { json } from '@sveltejs/kit';
import {
  getRegistrationOptions,
  verifyRegistration,
  getLoginOptions,
  verifyLogin
} from '$lib/server/webauthn';
import {
  findUserByCredentialId,
  saveAuthenticator,
  type Authenticator
} from '$lib/server/userService';
import { createSession } from '$lib/server/sessionService';
import { Buffer } from 'node:buffer';

// ------------------------------------
// Constants (DO NOT DERIVE DYNAMICALLY)
// ------------------------------------

const RP_ID = 'gorouteyourself.com';
const ORIGIN = 'https://gorouteyourself.com';
const CHALLENGE_COOKIE = 'webauthn_challenge';

// ------------------------------------
// Cookie helpers
// ------------------------------------

function setChallenge(cookies: any, challenge: string) {
  cookies.set(CHALLENGE_COOKIE, challenge, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 5 // 5 minutes
  });
}

function clearChallenge(cookies: any) {
  cookies.delete(CHALLENGE_COOKIE, { path: '/' });
}

// ------------------------------------
// GET — Generate options
// ------------------------------------

export async function GET({ url, cookies, locals }) {
  console.log('[WebAuthn GET] start');

  try {
    const type = url.searchParams.get('type');
    console.log('[WebAuthn GET] type:', type);
    console.log('[WebAuthn GET] user:', locals.user?.id);

    if (type === 'register') {
      if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      const options = await getRegistrationOptions(locals.user, RP_ID);
      setChallenge(cookies, options.challenge);

      console.log('[WebAuthn GET] registration options OK');
      return json(options);
    }

    // LOGIN
    const options = await getLoginOptions(RP_ID);
    setChallenge(cookies, options.challenge);

    console.log('[WebAuthn GET] login options OK');
    return json(options);

  } catch (err: any) {
    console.error('[WebAuthn GET ERROR]', err);
    return json(
      { error: err?.message || 'Failed to generate WebAuthn options' },
      { status: 500 }
    );
  }
}

// ------------------------------------
// POST — Verify response
// ------------------------------------

export async function POST({ request, cookies, platform, locals }) {
  const challenge = cookies.get(CHALLENGE_COOKIE);

  if (!challenge) {
    return json({ error: 'Missing WebAuthn challenge' }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const type = new URL(request.url).searchParams.get('type');

  try {
    // -----------------------
    // REGISTER
    // -----------------------
    if (type === 'register') {
      if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      const verification = await verifyRegistration(
        body,
        challenge,
        RP_ID,
        ORIGIN
      );

      if (!verification.verified || !verification.registrationInfo) {
        throw new Error('Registration verification failed');
      }

      const { credentialID, credentialPublicKey, counter } =
        verification.registrationInfo;

      const authenticator: Authenticator = {
        credentialID: Buffer.from(credentialID).toString('base64url'),
        credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
        transports: body.response?.transports ?? []
      };

      await saveAuthenticator(
        platform.env.KV,
        locals.user.id,
        authenticator
      );

      clearChallenge(cookies);
      console.log('[WebAuthn POST] registration verified');
      return json({ verified: true });
    }

    // -----------------------
    // LOGIN
    // -----------------------
    const credentialID = body?.id;
    if (!credentialID) {
      return json({ error: 'Missing credential ID' }, { status: 400 });
    }

    const user = await findUserByCredentialId(
      platform.env.KV,
      credentialID
    );

    if (!user || !user.authenticators) {
      return json({ error: 'User not found' }, { status: 400 });
    }

    const authenticator = user.authenticators.find(
      a => a.credentialID === credentialID
    );

    if (!authenticator) {
      return json({ error: 'Authenticator not found' }, { status: 400 });
    }

    const verification = await verifyLogin(
      body,
      challenge,
      {
        id: credentialID,
        publicKey: Buffer.from(authenticator.credentialPublicKey, 'base64url'),
        counter: authenticator.counter
      },
      RP_ID,
      ORIGIN
    );

    if (!verification.verified) {
      throw new Error('Authentication failed');
    }

    const session = await createSession(platform.env.KV, user);

    cookies.set('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7
    });

    clearChallenge(cookies);
    console.log('[WebAuthn POST] login verified');
    return json({ verified: true });

  } catch (err: any) {
    console.error('[WebAuthn POST ERROR]', err);
    clearChallenge(cookies);
    return json(
      { error: err?.message || 'WebAuthn verification failed' },
      { status: 400 }
    );
  }
}
