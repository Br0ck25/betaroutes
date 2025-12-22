import {
  generateRegistrationOptions as generateOptions,
  verifyRegistrationResponse as verifyResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type GenerateAuthenticationOptionsOpts,
  type VerifyAuthenticationResponseOpts,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

const RP_NAME = 'Go Route Yourself';

interface UserWithAuthenticators {
  id: string;
  email: string;
  name?: string;
  authenticators?: Array<{
    credentialID: string;
    transports?: AuthenticatorTransport[];
  }>;
}

export interface AuthenticatorForAuth {
  credentialID: string;
  credentialPublicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
}

export async function generateRegistrationOptions(
  user: UserWithAuthenticators,
  rpID: string
) {
  console.log('[WebAuthn Core] Generating registration options');
  console.log('[WebAuthn Core] User ID:', user.id);
  console.log('[WebAuthn Core] User email:', user.email);
  console.log('[WebAuthn Core] RP ID:', rpID);
  console.log('[WebAuthn Core] Existing authenticators:', user.authenticators?.length || 0);

  const excludeCredentials = (user.authenticators || [])
    .filter(auth => auth.credentialID && typeof auth.credentialID === 'string')
    .map((auth) => ({
      id: isoBase64URL.toBuffer(auth.credentialID),
      type: 'public-key' as const,
      transports: auth.transports || [],
    }));

  console.log('[WebAuthn Core] Excluding credentials:', excludeCredentials.length);

  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
  };

  const options = await generateOptions(opts);
  
  console.log('[WebAuthn Core] Registration options generated');
  
  return options;
}

export async function generateAuthenticationOptionsForUser(
  authenticators: AuthenticatorForAuth[],
  rpID: string
) {
  console.log('[WebAuthn Core] Generating authentication options');
  console.log('[WebAuthn Core] RP ID:', rpID);
  console.log('[WebAuthn Core] Authenticators:', authenticators.length);

  const allowCredentials = authenticators.map((auth) => ({
    id: isoBase64URL.toBuffer(auth.credentialID),
    type: 'public-key' as const,
    transports: auth.transports || [],
  }));

  const opts: GenerateAuthenticationOptionsOpts = {
    rpID: rpID,
    allowCredentials,
    userVerification: 'preferred',
  };

  const options = await generateAuthenticationOptions(opts);
  
  console.log('[WebAuthn Core] Authentication options generated');
  
  return options;
}

export async function verifyRegistrationResponse(
  credential: any,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedRPID: string
) {
  console.log('[WebAuthn Core] Starting registration verification');

  if (!expectedChallenge) {
    throw new Error('Challenge is required for verification');
  }

  if (!credential || !credential.response) {
    throw new Error('Credential response is required');
  }

  const opts: VerifyRegistrationResponseOpts = {
    response: credential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
  };

  const verification = await verifyResponse(opts);

  console.log('[WebAuthn Core] Registration verification complete');
  console.log('[WebAuthn Core] Verified:', verification.verified);

  return verification;
}

export async function verifyAuthenticationResponseForUser(
  credential: any,
  expectedChallenge: string,
  authenticator: AuthenticatorForAuth,
  expectedOrigin: string,
  expectedRPID: string
) {
  console.log('[WebAuthn Core] Starting authentication verification');
  console.log('[WebAuthn Core] Credential ID:', credential.id);

  if (!expectedChallenge) {
    throw new Error('Challenge is required for verification');
  }

  if (!credential || !credential.response) {
    throw new Error('Credential response is required');
  }

  const opts: VerifyAuthenticationResponseOpts = {
    response: credential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    authenticator: {
      credentialID: isoBase64URL.toBuffer(authenticator.credentialID),
      credentialPublicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
      counter: authenticator.counter,
    },
    requireUserVerification: false,
  };

  const verification = await verifyAuthenticationResponse(opts);

  console.log('[WebAuthn Core] Authentication verification complete');
  console.log('[WebAuthn Core] Verified:', verification.verified);

  return verification;
}