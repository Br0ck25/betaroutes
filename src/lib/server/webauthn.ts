// src/lib/server/webauthn.ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// Helper to determine RP ID from hostname (removes port if present)
// Note: WebAuthn requires a valid domain, not an IP address (unless localhost)

// --- Registration (Sign Up / Add Device) ---
export async function getRegistrationOptions(
    user: { id: string; username: string }, 
    rpID: string
) {
  // Fallback for user.id
  const userID = user.id || crypto.randomUUID();
  
  return await generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,
    userID,
    userName: user.username,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Forces FaceID/TouchID
    },
  });
}

export async function verifyRegistration(
    body: any, 
    currentChallenge: string,
    rpID: string,
    origin: string
) {
  return await verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
}

// --- Authentication (Login) ---
export async function getLoginOptions(rpID: string) {
  return await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });
}

export async function verifyLogin(
    body: any, 
    currentChallenge: string, 
    userCredential: { id: string; publicKey: Uint8Array; counter: number },
    rpID: string,
    origin: string
) {
  return await verifyAuthenticationResponse({
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