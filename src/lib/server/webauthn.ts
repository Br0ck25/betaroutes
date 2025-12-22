import {
  generateRegistrationOptions as generateOptions,
  verifyRegistrationResponse as verifyResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';

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

/**
 * Generate registration options for a user
 */
export async function generateRegistrationOptions(user: UserWithAuthenticators) {
  console.log('[WebAuthn Core] Generating registration options');
  console.log('[WebAuthn Core] User ID:', user.id);
  console.log('[WebAuthn Core] User email:', user.email);
  console.log('[WebAuthn Core] Existing authenticators:', user.authenticators?.length || 0);

  const excludeCredentials = (user.authenticators || []).map((auth) => ({
    id: Buffer.from(auth.credentialID, 'base64url'),
    type: 'public-key' as const,
    transports: auth.transports || [],
  }));

  console.log('[WebAuthn Core] Excluding credentials:', excludeCredentials.length);

  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: 'gorouteyourself.com',
    userID: new TextEncoder().encode(user.id), // ✅ FIXED - Convert to bytes
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

  console.log('[WebAuthn Core] Options configured');

  const options = await generateOptions(opts);
  
  console.log('[WebAuthn Core] Options generated');
  console.log('[WebAuthn Core] Challenge:', options.challenge ? 'Present' : 'Missing');
  
  return options;
}

/**
 * Verify registration response from authenticator
 */
export async function verifyRegistrationResponse(
  credential: any,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedRPID: string
) {
  console.log('[WebAuthn Core] Starting verification');
  console.log('[WebAuthn Core] Expected challenge:', expectedChallenge ? 'Present' : 'Missing');
  console.log('[WebAuthn Core] Expected origin:', expectedOrigin);
  console.log('[WebAuthn Core] Expected RP ID:', expectedRPID);
  console.log('[WebAuthn Core] Credential ID:', credential.id);

  if (!expectedChallenge) {
    console.error('[WebAuthn Core] ERROR: No challenge provided');
    throw new Error('Challenge is required for verification');
  }

  if (!credential) {
    console.error('[WebAuthn Core] ERROR: No credential provided');
    throw new Error('Credential is required for verification');
  }

  if (!credential.response) {
    console.error('[WebAuthn Core] ERROR: Credential missing response');
    throw new Error('Credential response is required');
  }

  try {
    const opts: VerifyRegistrationResponseOpts = {
      response: credential,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
    };

    console.log('[WebAuthn Core] Verification options configured');
    console.log('[WebAuthn Core] Calling verifyResponse...');

    const verification = await verifyResponse(opts);

    console.log('[WebAuthn Core] Verification complete');
    console.log('[WebAuthn Core] Verified:', verification.verified);
    
    if (verification.registrationInfo) {
      console.log('[WebAuthn Core] Registration info present');
      console.log('[WebAuthn Core] Credential ID length:', verification.registrationInfo.credentialID.length);
      console.log('[WebAuthn Core] Public key length:', verification.registrationInfo.credentialPublicKey.length);
      console.log('[WebAuthn Core] Counter:', verification.registrationInfo.counter);
    } else {
      console.log('[WebAuthn Core] No registration info');
    }

    return verification;
  } catch (error) {
    console.error('[WebAuthn Core] Verification error:', error);
    
    if (error instanceof Error) {
      console.error('[WebAuthn Core] Error name:', error.name);
      console.error('[WebAuthn Core] Error message:', error.message);
      console.error('[WebAuthn Core] Error stack:', error.stack);
    }
    
    throw error;
  }
}