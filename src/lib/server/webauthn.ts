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
import { normalizeCredentialID } from '$lib/server/webauthn-utils';

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

  // Filter and validate credentials before attempting to decode
  const validAuthenticators = (user.authenticators || []).filter(auth => {
    if (!auth.credentialID) {
      console.warn('[WebAuthn Core] Skipping authenticator with no credentialID');
      return false;
    }
    if (typeof auth.credentialID !== 'string') {
      console.warn('[WebAuthn Core] Skipping authenticator with non-string credentialID:', typeof auth.credentialID);
      return false;
    }
    if (auth.credentialID.length < 20) {
      console.warn('[WebAuthn Core] Skipping authenticator with suspiciously short credentialID:', auth.credentialID);
      return false;
    }
    // Check if it's valid base64url (only contains A-Z, a-z, 0-9, -, _)
    if (!/^[A-Za-z0-9_-]+$/.test(auth.credentialID)) {
      console.warn('[WebAuthn Core] Skipping authenticator with invalid base64url characters:', auth.credentialID);
      return false;
    }
    return true;
  });

  console.log('[WebAuthn Core] Valid authenticators after filtering:', validAuthenticators.length);

  const excludeCredentials = validAuthenticators.map((auth) => {
    console.log('[WebAuthn Core] Attempting to prepare exclude credential ID:', auth.credentialID);
    const normalized = normalizeCredentialID(auth.credentialID);
    if (!normalized) {
      console.warn('[WebAuthn Core] Skipping credential that cannot be normalized:', auth.credentialID);
      return null;
    }

    try {
      const buffer = isoBase64URL.toBuffer(normalized);
      console.log('[WebAuthn Core] Successfully decoded, buffer length:', buffer.length);
      return {
        id: buffer,
        type: 'public-key' as const,
        transports: auth.transports || [],
      };
    } catch (error) {
      console.error('[WebAuthn Core] Failed to decode credential after normalization:', normalized, error);
      return null;
    }
  }).filter((cred): cred is NonNullable<typeof cred> => cred !== null);

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