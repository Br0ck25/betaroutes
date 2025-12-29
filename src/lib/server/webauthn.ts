import {
	generateRegistrationOptions as generateOptions,
	verifyRegistrationResponse as verifyResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
	type GenerateRegistrationOptionsOpts,
	type VerifyRegistrationResponseOpts,
	type GenerateAuthenticationOptionsOpts,
	type VerifyAuthenticationResponseOpts
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

export async function generateRegistrationOptions(user: UserWithAuthenticators, rpID: string) {
	// debug: registration options generation logs removed
	// console.log('[WebAuthn Core] Generating registration options');
	// console.log('[WebAuthn Core] User ID:', user.id);
	// console.log('[WebAuthn Core] User email:', user.email);
	// console.log('[WebAuthn Core] RP ID:', rpID);
	// console.log('[WebAuthn Core] Existing authenticators:', user.authenticators?.length || 0);

	// Filter and validate credentials before attempting to use them
	const validAuthenticators = (user.authenticators || []).filter((auth) => {
		if (!auth.credentialID) {
			// console.warn('[WebAuthn Core] Skipping authenticator with no credentialID');
			return false;
		}
		if (typeof auth.credentialID !== 'string') {
			// console.warn(
			// 	'[WebAuthn Core] Skipping authenticator with non-string credentialID:',
			// 	typeof auth.credentialID
			// );
			return false;
		}
		if (auth.credentialID.length < 20) {
			// console.warn(
			// 	'[WebAuthn Core] Skipping authenticator with suspiciously short credentialID:',
			// 	auth.credentialID
			// );
			return false;
		}
		// Check if it's valid base64url (only contains A-Z, a-z, 0-9, -, _)
		if (!/^[A-Za-z0-9_-]+$/.test(auth.credentialID)) {
			// console.warn(
			// 	'[WebAuthn Core] Skipping authenticator with invalid base64url characters:',
			// 	auth.credentialID
			// );
			return false;
		}
		return true;
	});

	// console.log('[WebAuthn Core] Valid authenticators after filtering:', validAuthenticators.length);

	// IMPORTANT: Pass credential IDs as base64url STRINGS, not Buffers
	// The newer version of @simplewebauthn/server expects strings and will convert them internally
	const excludeCredentials = validAuthenticators.map((auth) => {
		// console.log(
		// 	'[WebAuthn Core] Adding to exclude list:',
		// 	auth.credentialID,
		// 	'length:',
		// 	auth.credentialID.length
		// );
		return {
			id: auth.credentialID, // Keep as string - library will handle conversion
			type: 'public-key' as const,
			transports: auth.transports || []
		};
	});

	// console.log('[WebAuthn Core] Excluding credentials:', excludeCredentials.length);

	const opts: GenerateRegistrationOptionsOpts = {
		rpName: RP_NAME,
		rpID: rpID,
		userID: new TextEncoder().encode(user.id), // Must be Uint8Array
		userName: user.email,
		userDisplayName: user.name || user.email,
		attestationType: 'none',
		excludeCredentials,
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred',
			authenticatorAttachment: 'platform'
		}
	};

	const options = await generateOptions(opts);

	// console.log('[WebAuthn Core] Registration options generated');

	return options;
}

export async function generateAuthenticationOptionsForUser(
	authenticators: AuthenticatorForAuth[],
	rpID: string
) {
	// debug: authentication options generation logs removed
	// console.log('[WebAuthn Core] Generating authentication options');
	// console.log('[WebAuthn Core] RP ID:', rpID);
	// console.log('[WebAuthn Core] Authenticators:', authenticators.length);

	// Pass credential IDs as base64url strings
	const allowCredentials = authenticators.map((auth) => ({
		id: auth.credentialID, // Keep as string
		type: 'public-key' as const,
		transports: auth.transports || []
	}));

	const opts: GenerateAuthenticationOptionsOpts = {
		rpID: rpID,
		allowCredentials,
		userVerification: 'preferred'
	};

	const options = await generateAuthenticationOptions(opts);

	// console.log('[WebAuthn Core] Authentication options generated');

	return options;
}

export async function verifyRegistrationResponse(
	credential: unknown,
	expectedChallenge: string,
	expectedOrigin: string,
	expectedRPID: string
) {
	// console.log('[WebAuthn Core] Starting registration verification');

	if (!expectedChallenge) {
		throw new Error('Challenge is required for verification');
	}

	if (!credential || typeof credential !== 'object' || !('response' in credential)) {
		throw new Error('Credential response is required');
	}

	const opts: VerifyRegistrationResponseOpts = {
		response: credential as VerifyRegistrationResponseOpts['response'],
		expectedChallenge,
		expectedOrigin,
		expectedRPID,
		requireUserVerification: false
	};

	const verification = await verifyResponse(opts);

	// console.log('[WebAuthn Core] Registration verification complete');
	// console.log('[WebAuthn Core] Verified:', verification.verified);

	return verification;
}

export async function verifyAuthenticationResponseForUser(
	credential: unknown,
	expectedChallenge: string,
	authenticator: AuthenticatorForAuth,
	expectedOrigin: string,
	expectedRPID: string
) {
	// console.log('[WebAuthn Core] Starting authentication verification');
	// console.log('[WebAuthn Core] Credential ID:', (credential as any)?.id);

	// diagnostic introspection removed

	if (!expectedChallenge) {
		throw new Error('Challenge is required for verification');
	}

	if (!credential || typeof credential !== 'object' || !('response' in credential)) {
		throw new Error('Credential response is required');
	}

	// Normalize credential response fields
	// IMPORTANT: leave typical response fields as base64url strings (the server library expects strings)
	const normalizedCredential: Record<string, unknown> = {
		...(credential as Record<string, unknown>)
	};
	const resp = (normalizedCredential['response'] || {}) as Record<string, unknown>;
	try {
		// Keep rawId, authenticatorData, clientDataJSON, signature, userHandle as strings if they're strings
		// (clients typically send base64url strings after serializing ArrayBuffers). Do not coerce to Buffers here.
		normalizedCredential['response'] = resp;
		// console.log('[WebAuthn Core] Normalized credential response types:', {
		// 	rawIdType: typeof normalizedCredential.rawId,
		// 	rawIdLength: (normalizedCredential.rawId as any)?.length,
		// 	authenticatorDataType: typeof resp.authenticatorData,
		// 	authenticatorDataLength: (resp.authenticatorData as any)?.length,
		// 	clientDataJSONType: typeof resp.clientDataJSON,
		// 	clientDataJSONLength: (resp.clientDataJSON as any)?.length,
		// 	signatureType: typeof resp.signature,
		// 	signatureLength: (resp.signature as any)?.length,
		// 	userHandleType: typeof resp.userHandle,
		// 	userHandleLength: (resp.userHandle as any)?.length
		// });

		// Try to decode clientDataJSON if it's a base64url string and log its parsed content
		try {
			function base64UrlToBuffer(s: string): Uint8Array | Buffer | null {
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

			let parsedClientData: Record<string, unknown> | null = null;
			if (typeof resp['clientDataJSON'] === 'string') {
				const buf = base64UrlToBuffer(resp['clientDataJSON'] as string);
				try {
					const jsonStr =
						typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)
							? buf.toString('utf8')
							: new TextDecoder().decode(buf as Uint8Array);
					parsedClientData = JSON.parse(jsonStr);
				} catch (err) {
					parsedClientData = { parseError: String(err) };
				}
			}

			// parsed clientDataJSON debug logs removed
			if (parsedClientData && parsedClientData['challenge']) {
				// parsed clientDataJSON challenge present (debug logs removed)
			}
			// diagnostic previews removed (debug-only)
		} catch {
			// console.warn('[WebAuthn Core] Failed to decode/inspect clientDataJSON');
		}
	} catch {
		// console.warn('[WebAuthn Core] Failed to inspect credential response fields');
	}

	// Validate that these fields are either base64url strings or binary-like buffers
	function isBinaryOrBase64urlString(v: unknown) {
		if (!v) return false;
		if (v instanceof ArrayBuffer) return true;
		if (ArrayBuffer.isView(v)) return true;
		if (typeof v === 'string' && /^[A-Za-z0-9\-_]+=*$/.test(v)) return true;
		return false;
	}

	if (
		!isBinaryOrBase64urlString(resp['authenticatorData']) ||
		!isBinaryOrBase64urlString(resp['clientDataJSON']) ||
		!isBinaryOrBase64urlString(resp['signature'])
	) {
		// console.error('[WebAuthn Core] Credential response fields are not in an accepted format', {
		// 	authenticatorDataType: typeof resp.authenticatorData,
		// 	clientDataJSONType: typeof resp.clientDataJSON,
		// 	signatureType: typeof resp.signature
		// });
		throw new Error('Invalid credential response shape');
	}

	const opts: VerifyAuthenticationResponseOpts = {
		response: normalizedCredential as unknown as VerifyAuthenticationResponseOpts['response'],
		expectedChallenge,
		expectedOrigin,
		expectedRPID,
		credential: {
			id: isoBase64URL.toBuffer(authenticator.credentialID),
			publicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
			counter: authenticator.counter,
			transports: authenticator.transports || []
		} as unknown as VerifyAuthenticationResponseOpts['credential'],
		requireUserVerification: false
	};

	let verification;
	try {
		// console.log('[WebAuthn Core] verifyAuthenticationResponse opts:', {
		// 	credential: {
		// 		idType: typeof opts.credential?.id,
		// 		idLength: (opts.credential?.id as any)?.length,
		// 		publicKeyType: typeof opts.credential?.publicKey,
		// 		publicKeyLength: (opts.credential?.publicKey as any)?.length,
		// 		counterType: typeof opts.credential?.counter,
		// 		counter: opts.credential?.counter
		// 	},
		// 	expectedChallengeType: typeof opts.expectedChallenge
		// });

		// Primary attempt: Buffers for both ID and public key (what we expect)
		verification = await verifyAuthenticationResponse(opts);
	} catch (e) {
		// console.error('[WebAuthn Core] verifyAuthenticationResponse threw:', e);
		// console.error('[WebAuthn Core] Attempting fallbacks for authenticator shape');

		// Log concise summary
		// console.error('[WebAuthn Core] verifyAuthenticationResponse opts (summary):', {
		// 	credentialIDPresent: !!opts.credential?.id,
		// 	credentialPublicKeyLength: (opts.credential?.publicKey as any)?.length,
		// 	counter: opts.credential?.counter
		// });

		// Fallback strategies: try different combinations of string vs Buffer for the two fields
		const attempts = [
			{
				name: 'ID-string / PublicKey-Buffer',
				credential: {
					id: authenticator.credentialID, // base64url string
					publicKey: isoBase64URL.toBuffer(authenticator.credentialPublicKey),
					counter: authenticator.counter,
					transports: authenticator.transports || []
				}
			},
			{
				name: 'ID-Buffer / PublicKey-string',
				credential: {
					id: isoBase64URL.toBuffer(authenticator.credentialID),
					publicKey: authenticator.credentialPublicKey, // base64url string
					counter: authenticator.counter,
					transports: authenticator.transports || []
				}
			},
			{
				name: 'ID-string / PublicKey-string',
				credential: {
					id: authenticator.credentialID,
					publicKey: authenticator.credentialPublicKey,
					counter: authenticator.counter,
					transports: authenticator.transports || []
				}
			}
		];

		for (const attempt of attempts) {
			try {
				// console.log('[WebAuthn Core] Fallback attempt:', attempt.name, {
				// 	idType: typeof attempt.credential.id,
				// 	idLength: (attempt.credential.id as any)?.length,
				// 	publicKeyType: typeof attempt.credential.publicKey,
				// 	publicKeyLength: (attempt.credential.publicKey as any)?.length,
				// 	counter: attempt.credential.counter
				// });

				const altOpts: VerifyAuthenticationResponseOpts = {
					response: credential as unknown as VerifyAuthenticationResponseOpts['response'],
					expectedChallenge,
					expectedOrigin,
					expectedRPID,
					credential:
						attempt.credential as unknown as VerifyAuthenticationResponseOpts['credential']
				};

				verification = await verifyAuthenticationResponse(altOpts);
				// console.log('[WebAuthn Core] Fallback attempt succeeded:', attempt.name);
				break;
			} catch {
				// fallback attempt failed (debug-only)
			}
		}

		if (!verification) {
			// console.error('[WebAuthn Core] All fallback attempts failed');
			throw e; // rethrow original error
		}
	}

	// console.log('[WebAuthn Core] Authentication verification complete');
	// console.log('[WebAuthn Core] Verified:', verification.verified);

	return verification;
}
