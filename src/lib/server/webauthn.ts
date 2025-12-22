import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { createHash } from 'node:crypto';

// ------------------------------------
// Helpers
// ------------------------------------

// Convert a string user ID into a stable Uint8Array
// REQUIRED by @simplewebauthn/server (strings are no longer allowed)
function userIdToUint8Array(userId: string): Uint8Array {
  return createHash('sha256').update(userId).digest();
}

// ------------------------------------
// Registration (Passkey Creation)
// ------------------------------------

export async function getRegistrationOptions(
  user: {
    id: string;
    username?: string;
    email?: string;
  },
  rpID: string
) {
  if (!user?.id) {
    throw new Error('Missing user ID for WebAuthn registration');
  }

  const userID = userIdToUint8Array(user.id);
  const userName = user.username || user.email || 'User';

  return generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,

    // 🔑 MUST be Uint8Array
    userID,
    userName,

    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });
}

export async function verifyRegistration(
  body: any,
  currentChallenge: string,
  rpID: string,
  origin: string
) {
  return verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

// ------------------------------------
// Authentication (Passkey Login)
// ------------------------------------

export async function getLoginOptions(rpID: string) {
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
