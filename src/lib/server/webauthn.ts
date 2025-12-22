// src/lib/server/webauthn.ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { env } from '$env/dynamic/private';

const RP_ID = 'localhost'; // CHANGE THIS to your production domain (e.g., 'gorouteyourself.com')
const ORIGIN = `http://${RP_ID}:5173`; // CHANGE THIS to https://your-domain.com in production

// --- Registration (Sign Up with FaceID) ---

export async function getRegistrationOptions(user: { id: string; username: string }) {
  const options = await generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID: RP_ID,
    userID: user.id,
    userName: user.username,
    // Don't prompt if they already have a passkey
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Forces TouchID/FaceID/Windows Hello
    },
  });
  return options;
}

export async function verifyRegistration(body: any, currentChallenge: string) {
  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  return verification;
}

// --- Authentication (Login with FaceID) ---

export async function getLoginOptions() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
  });
  return options;
}

export async function verifyLogin(body: any, currentChallenge: string, userCredential: { id: string; publicKey: Uint8Array; counter: number }) {
  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: currentChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    authenticator: {
      credentialID: userCredential.id,
      credentialPublicKey: userCredential.publicKey,
      counter: userCredential.counter,
    },
  });
  return verification;
}