// src/lib/server/webauthn.ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// [!code ++] Explicitly handle crypto for some environments
const getUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback if randomUUID is missing (rare in modern envs but possible)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

export async function getRegistrationOptions(
    user: { id: string; username: string; email: string }, 
    rpID: string
) {
  const userID = user.id || getUUID();
  // Ensure username is never null/undefined
  const userName = user.username || user.email || 'User'; 

  return await generateRegistrationOptions({
    rpName: 'Go Route Yourself',
    rpID,
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