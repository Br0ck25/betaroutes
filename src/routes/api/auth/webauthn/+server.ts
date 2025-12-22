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

// -----------------------------
// Helpers
// -----------------------------

function getRpID(url: URL) {
  // 🔒 FORCE canonical RP ID
  return 'gorouteyourself.com';
}

function setChallenge(cookies: any, challenge: string) {
  cookies.set('webauthn_challenge', challenge, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 5 // 5 minutes
  });
}

function clearChallenge(cookies: any) {
  cookies.delete('webauthn_challenge', { path: '/' });
}

// -----------------------------
// GET (options)
// -----------------------------

export async function GET({ url, cookies, locals }) {
  try {
    const type = url.searchParams.get('type');
    const rpID = getRpID(url);

    if (type === 'register') {
      if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      const options = await getRegistrationOptions(locals.user, rpID);
      setChallenge(cookies, options.challenge);
      return json(options);
    }

    // login
    const options = await getLoginOptions(rpID);
    setChallenge(cookies, options.challenge);
    return json(options);

  } catch (e: any) {
    console.error('[WebAuthn GET]', e);
    return json(
      { error: e.message || 'Failed to generate WebAuthn options' },
      { status: 500 }
    );
  }
}

// -----------------------------
// POST (verify)
// -----------------------------

export async function POST({ request, cookies, platform, locals }) {
  const body = await request.json();
  const challenge = cookies.get('webauthn_challenge');

  if (!challenge) {
    return json({ error: 'Missing WebAuthn challenge' }, { status: 400 });
  }

  const url = new URL(request.url);
  const rpID = getRpID(url);
  const origin = 'https://gorouteyourself.com';
  const type = url.searchParams.get('type');

  try {
    // -----------------------------
    // REGISTER
    // -----------------------------
    if (type === 'register') {
      if (!locals.user) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      const verification = await verifyRegistration(
        body,
        challenge,
        rpID,
        origin
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
      return json({ verified: true });
    }

    // -----------------------------
    // LOGIN
    // -----------------------------
    const credentialID = body.id;
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
      rpID,
      origin
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
    return json({ verified: true });

  } catch (e: any) {
    console.error('[WebAuthn POST]', e);
    clearChallenge(cookies);
    return json(
      { error: e.message || 'WebAuthn verification failed' },
      { status: 400 }
    );
  }
}
