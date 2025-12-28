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

  // Normalize credential response fields
  // IMPORTANT: leave typical response fields as base64url strings (the server library expects strings)
  const normalizedCredential: any = { ...credential };
  const resp: any = normalizedCredential.response || {};
  try {
    // Keep rawId, authenticatorData, clientDataJSON, signature, userHandle as strings if they're strings
    // (clients typically send base64url strings after serializing ArrayBuffers). Do not coerce to Buffers here.
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

    // Try to decode clientDataJSON if it's a base64url string and log its parsed content
    try {
      function base64UrlToBuffer(s: string) {
        if (!s) return null;
        const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
        const padding = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
        const norm = b64 + padding;
        if (typeof Buffer !== 'undefined') return Buffer.from(norm, 'base64');
        const binary = atob(norm);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
        return arr;
      }

      let parsedClientData: any = null;
      if (typeof resp.clientDataJSON === 'string') {
        const buf = base64UrlToBuffer(resp.clientDataJSON);
        try {
          const jsonStr = (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) ? buf.toString('utf8') : new TextDecoder().decode(buf as any);
          parsedClientData = JSON.parse(jsonStr);
        } catch (err) {
          parsedClientData = { parseError: String(err) };
        }
      }

      console.log('[WebAuthn Core] Parsed clientDataJSON:', parsedClientData);
      if (parsedClientData && parsedClientData.challenge) {
        console.log('[WebAuthn Core] clientDataJSON.challenge:', parsedClientData.challenge, 'expectedChallenge:', expectedChallenge);
        console.log('[WebAuthn Core] challenge equality (raw compare):', parsedClientData.challenge === expectedChallenge);
      }

      // Truncated previews for raw values (helpful for debugging formats)
      function truncate(s: any) { try { const str = String(s); return str.length > 100 ? str.slice(0,100) + '...' : str; } catch (e) { return String(s); } }
      console.log('[WebAuthn Core] Credential raw previews:', {
        id: truncate(credential?.id),
        rawId: truncate(credential?.rawId),
        authenticatorDataPreview: truncate(resp.authenticatorData),
        clientDataJSONPreview: truncate(resp.clientDataJSON),
        signaturePreview: truncate(resp.signature),
        userHandlePreview: truncate(resp.userHandle)
      });

      // Helper to print authenticator in readable base64url form
      function bufferToBase64Url(buf: any) {
        if (!buf) return null;
        if (typeof buf === 'string') return buf;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
          return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        if (ArrayBuffer.isView(buf) || buf instanceof ArrayBuffer) {
          const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as any);
          let binary = '';
          const len = (bytes && typeof bytes.length === 'number') ? bytes.length : 0;
          for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i] ?? 0);
          return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        return String(buf);
      }

      const authPreview = {
        credentialID: bufferToBase64Url(isoBase64URL.toBuffer(authenticator.credentialID)),
        credentialPublicKey: bufferToBase64Url(isoBase64URL.toBuffer(authenticator.credentialPublicKey)),
        counter: authenticator.counter
      };
      console.log('[WebAuthn Core] Authenticator preview (base64url):', authPreview);
    } catch (e) {
      console.warn('[WebAuthn Core] Failed to decode/inspect clientDataJSON', e);
    }
  } catch (e) {
    console.warn('[WebAuthn Core] Failed to inspect credential response fields', e);
  }

  // Validate that these fields are either base64url strings or binary-like buffers
  function isBinaryOrBase64urlString(v: any) {
    if (!v) return false;
    if (v instanceof ArrayBuffer) return true;
    if (ArrayBuffer.isView(v)) return true;
    if (typeof v === 'string' && /^[A-Za-z0-9\-_]+=*$/.test(v)) return true;
    return false;
  }

  if (!isBinaryOrBase64urlString(resp.authenticatorData) || !isBinaryOrBase64urlString(resp.clientDataJSON) || !isBinaryOrBase64urlString(resp.signature)) {
    console.error('[WebAuthn Core] Credential response fields are not in an accepted format', {
      authenticatorDataType: typeof resp.authenticatorData,
      clientDataJSONType: typeof resp.clientDataJSON,
      signatureType: typeof resp.signature
    });
    throw new Error('Invalid credential response shape');
  }

  const opts: VerifyAuthenticationResponseOpts = {
    response: normalizedCredential,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    credential: {
      id: isoBase64URL.toBuffer(authenticator.credentialID),
      publicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
      counter: authenticator.counter,
      transports: authenticator.transports || []
    } as any,
    requireUserVerification: false,
  };

  let verification;
  try {
    console.log('[WebAuthn Core] verifyAuthenticationResponse opts:', {
      credential: {
        idType: typeof opts.credential?.id,
        idLength: (opts.credential?.id as any)?.length,
        publicKeyType: typeof opts.credential?.publicKey,
        publicKeyLength: (opts.credential?.publicKey as any)?.length,
        counterType: typeof opts.credential?.counter,
        counter: opts.credential?.counter
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
      credentialIDPresent: !!opts.credential?.id,
      credentialPublicKeyLength: (opts.credential?.publicKey as any)?.length,
      counter: opts.credential?.counter
    });

    // Fallback strategies: try different combinations of string vs Buffer for the two fields
    const attempts = [
      {
        name: 'ID-string / PublicKey-Buffer',
        credential: {
          id: authenticator.credentialID, // base64url string
          publicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
          counter: authenticator.counter,
          transports: authenticator.transports || []
        },
      },
      {
        name: 'ID-Buffer / PublicKey-string',
        credential: {
          id: isoBase64URL.toBuffer(authenticator.credentialID),
          publicKey: authenticator.credentialPublicKey, // base64url string
          counter: authenticator.counter,
          transports: authenticator.transports || []
        },
      },
      {
        name: 'ID-string / PublicKey-string',
        credential: {
          id: authenticator.credentialID,
          publicKey: authenticator.credentialPublicKey,
          counter: authenticator.counter,
          transports: authenticator.transports || []
        },
      }
    ];

    for (const attempt of attempts) {
      try {
        console.log('[WebAuthn Core] Fallback attempt:', attempt.name, {
          idType: typeof attempt.credential.id,
          idLength: (attempt.credential.id as any)?.length,
          publicKeyType: typeof attempt.credential.publicKey,
          publicKeyLength: (attempt.credential.publicKey as any)?.length,
          counter: attempt.credential.counter
        });

        const altOpts: VerifyAuthenticationResponseOpts = {
          response: credential,
          expectedChallenge,
          expectedOrigin,
          expectedRPID,
          credential: attempt.credential as any,
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