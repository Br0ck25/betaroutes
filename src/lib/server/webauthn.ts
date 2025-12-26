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

  // Filter and validate credentials before attempting to use them
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

  // IMPORTANT: Pass credential IDs as base64url STRINGS, not Buffers
  // The newer version of @simplewebauthn/server expects strings and will convert them internally
  const excludeCredentials = validAuthenticators.map((auth) => {
    console.log('[WebAuthn Core] Adding to exclude list:', auth.credentialID, 'length:', auth.credentialID.length);
    return {
      id: auth.credentialID,  // Keep as string - library will handle conversion
      type: 'public-key' as const,
      transports: auth.transports || [],
    };
  });

  console.log('[WebAuthn Core] Excluding credentials:', excludeCredentials.length);

  const opts: GenerateRegistrationOptionsOpts = {
    rpName: RP_NAME,
    rpID: rpID,
    userID: new TextEncoder().encode(user.id),  // Must be Uint8Array
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

  // Pass credential IDs as base64url strings
  const allowCredentials = authenticators.map((auth) => ({
    id: auth.credentialID,  // Keep as string
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
  console.log('[WebAuthn Core] Credential ID:', credential?.id);

  // Diagnostic: log credential response shapes
  try {
    console.log('[WebAuthn Core] Credential keys:', Object.keys(credential || {}));
    console.log('[WebAuthn Core] Credential.response keys:', Object.keys(credential?.response || {}));
    const resp = credential?.response || {};
    function maybeLen(v: any) {
      if (!v) return 0;
      if (typeof v === 'string') return v.length;
      if (v instanceof ArrayBuffer) return v.byteLength;
      if (ArrayBuffer.isView(v)) return (v as any).byteLength || (v as any).length || 0;
      if (v && typeof v.length === 'number') return v.length;
      return 0;
    }
    console.log('[WebAuthn Core] Credential response types/lengths:', {
      rawIdType: typeof credential?.rawId,
      rawIdLength: maybeLen(credential?.rawId),
      authenticatorDataType: typeof resp.authenticatorData,
      authenticatorDataLength: maybeLen(resp.authenticatorData),
      clientDataJSONType: typeof resp.clientDataJSON,
      clientDataJSONLength: maybeLen(resp.clientDataJSON),
      signatureType: typeof resp.signature,
      signatureLength: maybeLen(resp.signature),
      userHandleType: typeof resp.userHandle,
      userHandleLength: maybeLen(resp.userHandle)
    });
  } catch (e) {
    console.error('[WebAuthn Core] Failed to introspect credential:', e);
  }

  if (!expectedChallenge) {
    throw new Error('Challenge is required for verification');
  }

  if (!credential || !credential.response) {
    throw new Error('Credential response is required');
  }

  // Normalize credential response fields (convert base64url strings to Buffers)
  const normalizedCredential: any = { ...credential };
  const resp: any = normalizedCredential.response || {};
  try {
    if (typeof normalizedCredential.rawId === 'string') {
      normalizedCredential.rawId = isoBase64URL.toBuffer(normalizedCredential.rawId);
    }
    if (typeof resp.authenticatorData === 'string') {
      resp.authenticatorData = isoBase64URL.toBuffer(resp.authenticatorData);
    }
    if (typeof resp.clientDataJSON === 'string') {
      resp.clientDataJSON = isoBase64URL.toBuffer(resp.clientDataJSON);
    }
    if (typeof resp.signature === 'string') {
      resp.signature = isoBase64URL.toBuffer(resp.signature);
    }
    if (typeof resp.userHandle === 'string') {
      resp.userHandle = isoBase64URL.toBuffer(resp.userHandle);
    }
    normalizedCredential.response = resp;
    console.log('[WebAuthn Core] Normalized credential response types:', {
      rawIdType: typeof normalizedCredential.rawId,
      rawIdLength: (normalizedCredential.rawId as any)?.length,
      authenticatorDataType: typeof resp.authenticatorData,
      authenticatorDataLength: (resp.authenticatorData as any)?.length,
      clientDataJSONType: typeof resp.clientDataJSON,
      clientDataJSONLength: (resp.clientDataJSON as any)?.length,
      signatureType: typeof resp.signature,
      signatureLength: (resp.signature as any)?.length,
      userHandleType: typeof resp.userHandle,
      userHandleLength: (resp.userHandle as any)?.length,
    });
  } catch (e) {
    console.warn('[WebAuthn Core] Failed to convert credential response fields to buffers', e);
  }

  // Validate binary fields are present
  function isBufferLike(v: any) {
    return v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (v && typeof v.buffer === 'object' && typeof v.byteLength === 'number');
  }
  if (!isBufferLike(resp.authenticatorData) || !isBufferLike(resp.clientDataJSON) || !isBufferLike(resp.signature)) {
    console.error('[WebAuthn Core] Credential response fields are not binary as expected', {
      authenticatorDataType: typeof resp.authenticatorData,
      clientDataJSONType: typeof resp.clientDataJSON,
      signatureType: typeof resp.signature
    });
    throw new Error('Invalid credential response shape');
  }

  const opts: VerifyAuthenticationResponseOpts = {
    response: normalizedCredential,
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

  let verification;
  try {
    console.log('[WebAuthn Core] verifyAuthenticationResponse opts:', {
      authenticator: {
        credentialIDType: typeof opts.authenticator?.credentialID,
        credentialIDLength: opts.authenticator?.credentialID?.length,
        credentialPublicKeyType: typeof opts.authenticator?.credentialPublicKey,
        credentialPublicKeyLength: (opts.authenticator?.credentialPublicKey as any)?.length,
        counterType: typeof opts.authenticator?.counter,
        counter: opts.authenticator?.counter
      },
      expectedChallengeType: typeof opts.expectedChallenge
    });

    // Primary attempt: Buffers for both ID and public key (what we expect)
    verification = await verifyAuthenticationResponse(opts);
  } catch (e) {
    console.error('[WebAuthn Core] verifyAuthenticationResponse threw:', e);
    console.error('[WebAuthn Core] Attempting fallbacks for authenticator shape');

    // Log concise summary
    console.error('[WebAuthn Core] verifyAuthenticationResponse opts (summary):', {
      credentialIDPresent: !!opts.authenticator?.credentialID,
      credentialPublicKeyLength: (opts.authenticator?.credentialPublicKey as any)?.length,
      counter: opts.authenticator?.counter
    });

    // Fallback strategies: try different combinations of string vs Buffer for the two fields
    const attempts = [
      {
        name: 'ID-string / PublicKey-Buffer',
        authenticator: {
          credentialID: authenticator.credentialID, // original base64url string
          credentialPublicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
          counter: authenticator.counter,
        },
      },
      {
        name: 'ID-Buffer / PublicKey-string',
        authenticator: {
          credentialID: isoBase64URL.toBuffer(authenticator.credentialID),
          credentialPublicKey: authenticator.credentialPublicKey, // base64url string
          counter: authenticator.counter,
        },
      },
      {
        name: 'ID-string / PublicKey-string',
        authenticator: {
          credentialID: authenticator.credentialID,
          credentialPublicKey: authenticator.credentialPublicKey,
          counter: authenticator.counter,
        },
      }
    ];

    for (const attempt of attempts) {
      try {
        console.log('[WebAuthn Core] Fallback attempt:', attempt.name, {
          credentialIDType: typeof attempt.authenticator.credentialID,
          credentialIDLength: (attempt.authenticator.credentialID as any)?.length,
          credentialPublicKeyType: typeof attempt.authenticator.credentialPublicKey,
          credentialPublicKeyLength: (attempt.authenticator.credentialPublicKey as any)?.length,
          counter: attempt.authenticator.counter
        });

        const altOpts: VerifyAuthenticationResponseOpts = {
          response: credential,
          expectedChallenge,
          expectedOrigin,
          expectedRPID,
          authenticator: attempt.authenticator as any,
          requireUserVerification: false,
        };

        verification = await verifyAuthenticationResponse(altOpts);
        console.log('[WebAuthn Core] Fallback attempt succeeded:', attempt.name);
        break;
      } catch (err) {
        console.error('[WebAuthn Core] Fallback attempt failed:', attempt.name, err instanceof Error ? err.message : String(err));
      }
    }

    if (!verification) {
      console.error('[WebAuthn Core] All fallback attempts failed');
      throw e; // rethrow original error
    }
  }

  console.log('[WebAuthn Core] Authentication verification complete');
  console.log('[WebAuthn Core] Verified:', verification.verified);

  return verification;
}