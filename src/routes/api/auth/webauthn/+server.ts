// src/routes/api/auth/webauthn/+server.ts
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

      cookies.set('webauthn-challenge', options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

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

      cookies.set('webauthn-challenge', options.challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 300
      });

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

      await addAuthenticator(env.BETA_USERS_KV, user.id, {
        credentialID: Buffer.from(credentialID).toString('base64url'),
        credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter: counter,
        transports: credential.response.transports || []
      });

      cookies.delete('webauthn-challenge', { path: '/' });

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

      const userId = await getUserIdByCredentialID(env.BETA_USERS_KV, credentialID);
      
      if (!userId) {
        return json({ error: 'Passkey not found' }, { status: 404 });
      }

      const authenticators = await getUserAuthenticators(env.BETA_USERS_KV, userId);
      const authenticator = authenticators.find(auth => auth.credentialID === credentialID);

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

      const authInfo = verification.authenticationInfo;
      const newCounter = authInfo.newCounter ?? authInfo.counter ?? authenticator.counter + 1;
      
      await updateAuthenticatorCounter(env.BETA_USERS_KV, userId, credentialID, newCounter);

      cookies.delete('webauthn-challenge', { path: '/' });

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