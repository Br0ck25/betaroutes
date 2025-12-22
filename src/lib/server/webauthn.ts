// src/lib/server/webauthn.ts - FIXED VERSION
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

// ------------------------------------
// Helpers
// ------------------------------------

// MUST be stable + identical everywhere
function userIdToUint8Array(userId: string): Uint8Array {
  return createHash('sha256').update(userId).digest();
}

// ------------------------------------
// Registration
// ------------------------------------

export async function getRegistrationOptions(
  user: { id: string; username?: string; email?: string; authenticators?: any[] },
  rpID: string
) {
  if (!user?.id) {
    throw new Error('Missing user ID for WebAuthn registration');
  }

  // 🔧 FIX 1: Exclude existing credentials to prevent duplicate registration
  const excludeCredentials = (user.authenticators || []).map((auth: any) => ({
    id: Buffer.from(auth.credentialID, 'base64url'),
    type: 'public-key' as const,
    transports: auth.transports,
  }));

  console.log('[WebAuthn] Generating registration options for', user.username || user.email);
  console.log('[WebAuthn] Excluding', excludeCredentials.length, 'existing credentials');

  return generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,
    userID: userIdToUint8Array(user.id),
    userName: user.username || user.email || 'User',
    attestationType: 'none',
    excludeCredentials,
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
  origin: string,
  userId: string
) {
  console.log('[WebAuthn] Verifying registration...');
  console.log('[WebAuthn] Expected challenge:', currentChallenge.substring(0, 20) + '...');
  console.log('[WebAuthn] Expected origin:', origin);
  console.log('[WebAuthn] Expected RP ID:', rpID);

  // 🔧 FIX 2: Make userID verification optional (some authenticators don't include it)
  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    // Don't require userID match - it's optional in WebAuthn spec
  });

  console.log('[WebAuthn] Verification result:', verification.verified);

  return verification;
}

// ------------------------------------
// Authentication (Login)
// ------------------------------------

export async function getLoginOptions(rpID: string) {
  console.log('[WebAuthn] Generating login options for RP ID:', rpID);

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
  console.log('[WebAuthn] Verifying authentication...');
  console.log('[WebAuthn] Credential ID:', userCredential.id.substring(0, 20) + '...');

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