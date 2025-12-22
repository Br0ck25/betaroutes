// src/lib/server/webauthn.ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

/**
 * WebAuthn requires:
 * - a persistent, stable user ID
 * - a correct RP ID (domain only)
 * - an HTTPS origin
 *
 * Any violation will cause cryptic 500 errors.
 */

// -----------------------------
// Registration (Passkey Setup)
// -----------------------------

export async function getRegistrationOptions(
  user: {
    id: string;
    username?: string;
    email?: string;
  },
  rpID: string
) {
  if (!user?.id) {
    throw new Error('WebAuthn registration requires a persistent user.id');
  }

  if (!rpID) {
    throw new Error('Missing rpID for WebAuthn registration');
  }

  const userName = user.username || user.email || 'User';

  return generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,
    userID: user.id, // MUST be stable
    userName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      // authenticatorAttachment intentionally omitted
      // to allow both platform + cross-platform keys
    },
  });
}

export async function verifyRegistration(
  body: any,
  currentChallenge: string,
  rpID: string,
  origin: string
) {
  if (!currentChallenge) {
    throw new Error('Missing registration challenge');
  }

  if (!rpID || !origin) {
    throw new Error('Missing RP configuration');
  }

  if (!origin.startsWith('https://')) {
    throw new Error('WebAuthn requires HTTPS origin');
  }

  return verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

// -----------------------------
// Authentication (Login)
// -----------------------------

export async function getLoginOptions(rpID: string) {
  if (!rpID) {
    throw new Error('Missing rpID for WebAuthn login');
  }

  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });
}

export async function verifyLogin(
  body: any,
  currentChallenge: string,
  userCredential: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
  },
  rpID: string,
  origin: string
) {
  if (!currentChallenge) {
    throw new Error('Missing authentication challenge');
  }

  if (!userCredential?.id) {
    throw new Error('Missing authenticator credential');
  }

  if (!rpID || !origin) {
    throw new Error('Missing RP configuration');
  }

  if (!origin.startsWith('https://')) {
    throw new Error('WebAuthn requires HTTPS origin');
  }

  return verifyAuthenticationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: userCredential.id,
      credentialPublicKey: userCredential.publicKey,
      counter: userCredential.counter,
    },
  });
}
