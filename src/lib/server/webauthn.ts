import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { createHash } from 'node:crypto';

// Convert string user ID → stable Uint8Array
function userIdToUint8Array(userId: string): Uint8Array {
  return createHash('sha256').update(userId).digest();
}

// -----------------------------
// Registration
// -----------------------------

export async function getRegistrationOptions(
  user: { id: string; username?: string; email?: string },
  rpID: string
) {
  if (!user?.id) {
    throw new Error('Missing user ID');
  }

  return generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,
    userID: userIdToUint8Array(user.id),
    userName: user.username || user.email || 'User',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  });
}

export function verifyRegistration(
  body: any,
  challenge: string,
  rpID: string,
  origin: string
) {
  return verifyRegistrationResponse({
    response: body,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

// -----------------------------
// Login
// -----------------------------

export function getLoginOptions(rpID: string) {
  return generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });
}

export function verifyLogin(
  body: any,
  challenge: string,
  authenticator: {
    id: string;
    publicKey: Uint8Array;
    counter: number;
  },
  rpID: string,
  origin: string
) {
  return verifyAuthenticationResponse({
    response: body,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: authenticator.id,
      credentialPublicKey: authenticator.publicKey,
      counter: authenticator.counter,
    },
  });
}
