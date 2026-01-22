import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	type GenerateAuthenticationOptionsOpts,
	type VerifyRegistrationResponseOpts
} from '@simplewebauthn/server';
import { verifyAuthenticationResponseForUser } from '$lib/server/webauthn';
import {
	getUserAuthenticators,
	addAuthenticator,
	updateAuthenticatorCounter,
	getUserIdByCredentialID
} from '$lib/server/authenticatorService';
import { getEnv, safeKV } from '$lib/server/env';
import { createSession } from '$lib/server/sessionService';
import { findUserById } from '$lib/server/userService';
import { dev } from '$app/environment';
import { log } from '$lib/server/log';

function getRpID(context: { url: URL }): string {
	const hostname = context.url.hostname;
	if (hostname === 'localhost' || hostname === '127.0.0.1') {
		return 'localhost';
	}
	return 'gorouteyourself.com';
}

function getOrigin(request: Request): string {
	return new URL(request.url).origin;
}

// Convert ArrayBuffer/Uint8Array/Buffer-like values to base64url string safely.
function toBase64Url(input: unknown): string {
	if (!input) return '';
	if (typeof input === 'string') return input;

	let bytes: Uint8Array;
	if (input instanceof Uint8Array) {
		bytes = input;
	} else if (ArrayBuffer.isView(input)) {
		const view = input as ArrayBufferView & {
			byteOffset?: number;
			byteLength?: number;
			length?: number;
		};
		bytes = new Uint8Array(view.buffer, view.byteOffset || 0, view.byteLength || view.length || 0);
	} else if (input instanceof ArrayBuffer) {
		bytes = new Uint8Array(input);
	} else if (
		typeof input === 'object' &&
		input !== null &&
		'buffer' in input &&
		'byteLength' in input
	) {
		// fallback for exotic typed shapes
		try {
			bytes = new Uint8Array((input as { buffer: ArrayBuffer }).buffer);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			log.error('[webauthn] Unsupported input type', { message: msg });
			throw new Error('Unsupported input type for base64url conversion');
		}
	} else {
		throw new Error('Unsupported input type for base64url conversion');
	}

	// Convert to regular base64
	let base64: string = '';

	try {
		if (typeof Buffer !== 'undefined') {
			base64 = Buffer.from(bytes).toString('base64');
		} else if (typeof btoa !== 'undefined') {
			let binary = '';
			const len = bytes && typeof bytes.length === 'number' ? bytes.length : 0;
			for (let i = 0; i < len; i++) {
				binary += String.fromCharCode(bytes[i] ?? 0);
			}
			base64 = btoa(binary);
		} else {
			throw new Error('No base64 encoding method available');
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error('[webauthn] Base64 encoding failed', { message: msg });
		throw new Error('Failed to encode to base64');
	}

	if (typeof base64 !== 'string' || base64.length === 0) {
		log.error('[webauthn] toBase64Url produced invalid output', { type: typeof base64 });
		throw new Error('Failed to convert to base64 string');
	}

	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Convert base64url string back to Uint8Array
function fromBase64Url(base64url: string): Uint8Array {
	if (!base64url) {
		throw new Error('Empty base64url string');
	}

	// Convert base64url to regular base64
	let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');

	// Add padding if needed
	const padding = base64.length % 4;
	if (padding) {
		base64 += '='.repeat(4 - padding);
	}

	try {
		if (typeof Buffer !== 'undefined') {
			return new Uint8Array(Buffer.from(base64, 'base64'));
		} else if (typeof atob !== 'undefined') {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return bytes;
		} else {
			throw new Error('No base64 decoding method available');
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		log.error('[webauthn] Base64 decoding failed', { message: msg });
		throw new Error('Failed to decode base64');
	}
}

export const GET: RequestHandler = async ({ url, locals, cookies, platform }) => {
	try {
		const type = url.searchParams.get('type');

		if (type === 'register') {
			const user = locals.user as { id?: string; email?: string; name?: string } | undefined;
			if (!user || !user.email) {
				return json({ error: 'Not authenticated' }, { status: 401 });
			}

			const env = getEnv(platform);
			const usersKV = safeKV(env, 'BETA_USERS_KV');
			if (!usersKV) {
				return json({ error: 'Service Unavailable' }, { status: 503 });
			}

			const authenticators = await getUserAuthenticators(usersKV, user.id ?? '');

			const rpID = getRpID({ url });

			// Generate registration options using the library directly
			const options = await generateRegistrationOptions({
				rpName: 'Go Route Yourself',
				rpID,
				userID: new TextEncoder().encode(user.id), // CRITICAL: Must be Uint8Array
				userName: user.email,
				userDisplayName: user.name || user.email,
				attestationType: 'none',
				excludeCredentials: authenticators.map((auth) => ({
					id: auth.credentialID, // Keep as string - library handles conversion
					type: 'public-key' as const,
					transports: auth.transports as unknown as AuthenticatorTransport[]
				})),
				authenticatorSelection: {
					authenticatorAttachment: 'platform',
					residentKey: 'preferred',
					userVerification: 'preferred',
					requireResidentKey: false
				},
				timeout: 60000
			});

			if (!options || !options.challenge) {
				return json({ error: 'Failed to generate options' }, { status: 500 });
			}

			// Convert binary fields to base64url strings for JSON serialization
			try {
				if (options.challenge && typeof options.challenge !== 'string') {
					options.challenge = toBase64Url(options.challenge);
				}

				if (Array.isArray(options.excludeCredentials)) {
					options.excludeCredentials = options.excludeCredentials.map((c: unknown) => {
						const id = (c as { id?: unknown })?.id;
						if (typeof id === 'string')
							return { ...(c as Record<string, unknown>), id, type: 'public-key' };
						try {
							return { ...(c as Record<string, unknown>), id: toBase64Url(id), type: 'public-key' };
						} catch (err: unknown) {
							const msg = err instanceof Error ? err.message : String(err);
							log.error('[webauthn] excludeCredential id conversion failed', { message: msg });
							throw err;
						}
					});
				}
			} catch (convErr: unknown) {
				const msg = convErr instanceof Error ? convErr.message : String(convErr);
				log.warn('[webauthn] Failed to convert registration options', { message: msg });
				return json(
					{
						error: 'Failed to generate options',
						details: msg
					},
					{ status: 500 }
				);
			}

			cookies.set('webauthn-challenge', String(options.challenge), {
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax',
				path: '/',
				maxAge: 300
			});

			return json(options);
		} else {
			// Authentication - generate options without requiring existing session
			const env = platform?.env;
			if (!env || !env.BETA_USERS_KV) {
				return json({ error: 'Service Unavailable' }, { status: 503 });
			}

			const rpID = getRpID({ url });

			// Optionally restrict authentication to a single credential when requested
			const requestedCredential = url.searchParams.get('credential');

			// For passwordless authentication, we can either allow discoverable credentials (no allowCredentials)
			// or restrict to a single credential by including it in allowCredentials
			const opts: GenerateAuthenticationOptionsOpts = {
				rpID,
				userVerification: 'preferred',
				timeout: 60000
			};

			if (requestedCredential) {
				// Restrict to a specific credential id (string form is acceptable for the library)
				const allow = [{ id: requestedCredential, type: 'public-key' as const }];
				opts.allowCredentials =
					allow as unknown as GenerateAuthenticationOptionsOpts['allowCredentials'];
			}

			const options = await generateAuthenticationOptions(opts);

			if (!options || !options.challenge) {
				return json({ error: 'Failed to generate options' }, { status: 500 });
			}

			// Convert binary fields to base64url strings
			try {
				if (options.challenge && typeof options.challenge !== 'string') {
					options.challenge = toBase64Url(options.challenge);
				}

				if (Array.isArray(options.allowCredentials)) {
					options.allowCredentials = options.allowCredentials.map((c: unknown) => {
						const id = (c as { id?: unknown })?.id;
						if (typeof id === 'string')
							return { ...(c as Record<string, unknown>), id, type: 'public-key' };
						try {
							return { ...(c as Record<string, unknown>), id: toBase64Url(id), type: 'public-key' };
						} catch (err: unknown) {
							const msg = err instanceof Error ? err.message : String(err);
							log.error('[webauthn] allowCredential id conversion failed', { message: msg });
							throw err;
						}
					});
				}
			} catch (convErr: unknown) {
				const msg = convErr instanceof Error ? convErr.message : String(convErr);
				log.warn('[webauthn] Failed to convert authentication options', { message: msg });
				return json({ error: 'Failed to generate options', details: msg }, { status: 500 });
			}

			cookies.set('webauthn-challenge', String(options.challenge), {
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax',
				path: '/',
				maxAge: 300
			});

			return json(options);
		}
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		log.error('[WebAuthn] GET Error', { message: msg });
		// [!code fix] Issue #36: Don't expose error details to client
		return json(
			{
				error: 'Failed to generate options'
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	try {
		const type = new URL(request.url).searchParams.get('type');

		if (type === 'register') {
			const user = locals.user as { id?: string; email?: string; name?: string } | undefined;
			if (!user || !user.email) {
				return json({ error: 'Not authenticated' }, { status: 401 });
			}

			const env = platform?.env as Record<string, unknown> | undefined;
			if (!env || !('BETA_USERS_KV' in env)) {
				return json({ error: 'Service Unavailable' }, { status: 503 });
			}

			const expectedChallenge = cookies.get('webauthn-challenge');
			if (!expectedChallenge) {
				return json({ error: 'Challenge expired' }, { status: 400 });
			}

			// Accept either raw credential JSON or a wrapper { credential, deviceName }
			const body = (await request.json()) as
				| { credential?: unknown; deviceName?: string }
				| undefined;
			const credential = body?.credential ?? body;
			const deviceNameFromClient: string | undefined = body?.deviceName;
			const expectedOrigin = getOrigin(request);
			const expectedRPID = getRpID({ url: new URL(request.url) });

			if (!credential) {
				return json({ error: 'Missing credential' }, { status: 400 });
			}

			const verification = await verifyRegistrationResponse({
				response: credential as VerifyRegistrationResponseOpts['response'],
				expectedChallenge,
				expectedOrigin,
				expectedRPID
			});
			if (!verification.verified || !verification.registrationInfo) {
				return json({ error: 'Verification failed' }, { status: 400 });
			}

			const { registrationInfo } = verification;

			log.info('[WebAuthn] Registration info generated', {
				keysCount: Object.keys(registrationInfo).length
			});

			const credObj = credential as { id?: unknown } | undefined;
			const storedCredentialID = typeof credObj?.id === 'string' ? credObj.id : undefined;
			log.info('[WebAuthn] Credential received from browser', { hasId: !!storedCredentialID });

			// CRITICAL: Use credential.id from browser (already base64url)
			// This ensures exact match during authentication

			// Get public key from registrationInfo.credential.publicKey
			// It's returned as an object with numeric indices, convert to Uint8Array
			const credentialPublicKeyObj = registrationInfo.credential?.publicKey;
			const counter = registrationInfo.credential?.counter ?? 0;

			log.info('[WebAuthn] Credential processed', {
				hasId: !!storedCredentialID,
				publicKeyType: typeof credentialPublicKeyObj,
				hasPublicKey: !!credentialPublicKeyObj,
				counter
			});

			if (!storedCredentialID) {
				log.error('[WebAuthn] Missing credential ID from browser');
				return json({ error: 'Invalid credential ID' }, { status: 400 });
			}

			if (!credentialPublicKeyObj) {
				log.error('[WebAuthn] Missing publicKey from registrationInfo.credential');
				log.info('[WebAuthn] Available credential fields', {
					keys: Object.keys(registrationInfo.credential || {})
				});
				return json(
					{ error: 'Invalid credential public key - not found in credential object' },
					{ status: 400 }
				);
			}

			// Convert object with numeric indices to Uint8Array
			let credentialPublicKey: Uint8Array;
			try {
				const length = Object.keys(
					credentialPublicKeyObj as unknown as Record<string, unknown>
				).length;
				credentialPublicKey = new Uint8Array(length);
				for (let i = 0; i < length; i++) {
					const v = (credentialPublicKeyObj as unknown as Record<string, unknown>)[String(i)];
					credentialPublicKey[i] = typeof v === 'number' ? v : Number(v) || 0;
				}
				log.info('[WebAuthn] Converted publicKey to Uint8Array', {
					length: credentialPublicKey.length
				});
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				log.error('[WebAuthn] Failed to convert publicKey to Uint8Array', { message: msg });
				return json({ error: 'Failed to convert public key' }, { status: 400 });
			}

			let storedPublicKey: string;
			try {
				// Convert Uint8Array public key to base64url string for storage
				storedPublicKey = toBase64Url(credentialPublicKey);
				log.info('[WebAuthn] Converted public key to base64url', {
					length: storedPublicKey.length
				});
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				log.error('[WebAuthn] Failed to convert public key to base64url', { message: msg });
				return json({ error: 'Failed to process credential public key' }, { status: 400 });
			}

			log.info('[WebAuthn] Storing authenticator for user', {
				hasCredential: !!storedCredentialID
			});
			log.info('[WebAuthn] Creating index for authenticator', {
				hasCredential: !!storedCredentialID
			});

			// Compute friendly device name: prefer client-supplied name, otherwise infer from User-Agent
			const deviceNameClient =
				credential && typeof (credential as { deviceName?: unknown }).deviceName === 'string'
					? (credential as { deviceName?: string }).deviceName
					: deviceNameFromClient;
			const uaHeader = String(request.headers.get('user-agent') || '');
			const transportsFromCredential =
				credential &&
				typeof (credential as { response?: { transports?: unknown } }).response === 'object'
					? (((credential as { response?: { transports?: unknown } }).response
							?.transports as unknown as string[]) ?? [])
					: [];
			function inferDeviceNameFromUA(ua: string) {
				if (!ua) return 'Unknown device';
				let os = 'Device';
				if (/Android/i.test(ua)) os = 'Android device';
				else if (/Windows/i.test(ua)) os = 'Windows device';
				else if (/Mac|Macintosh/i.test(ua)) os = 'Mac device';
				else if (/iPhone|iPad/i.test(ua)) os = 'iOS device';
				let browser = '';
				if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
				else if (/Firefox/i.test(ua)) browser = 'Firefox';
				else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
				else if (/Edg/i.test(ua)) browser = 'Edge';
				return browser ? `${browser} on ${os}` : os;
			}

			const deviceName = deviceNameClient || inferDeviceNameFromUA(uaHeader);
			const createdAt = new Date().toISOString();

			const { safeKV } = await import('$lib/server/env');
			await addAuthenticator(safeKV(env, 'BETA_USERS_KV')!, user.id ?? '', {
				credentialID: storedCredentialID,
				credentialPublicKey: storedPublicKey,
				counter: counter,
				transports: transportsFromCredential as unknown as AuthenticatorTransport[],
				name: deviceName,
				createdAt
			});

			cookies.delete('webauthn-challenge', { path: '/' });

			log.info('[WebAuthn] Registration complete', {
				registered: true,
				hasCredential: !!storedCredentialID
			});

			// Return the created authenticator so the client can update UI immediately
			return json({
				success: true,
				verified: true,
				message: 'Passkey registered!',
				authenticator: {
					credentialID: storedCredentialID,
					name: deviceName,
					createdAt,
					transports: transportsFromCredential
				}
			});
		} else {
			// AUTHENTICATION FLOW
			const { getEnv, safeKV } = await import('$lib/server/env');
			const env = getEnv(platform);
			if (!safeKV(env, 'BETA_USERS_KV')) {
				return json({ error: 'Service Unavailable' }, { status: 503 });
			}

			const sessionKv = safeKV(env, 'BETA_SESSIONS_KV');
			if (!sessionKv) {
				return json({ error: 'Session service unavailable' }, { status: 503 });
			}

			const expectedChallenge = cookies.get('webauthn-challenge');
			if (!expectedChallenge) {
				return json({ error: 'Challenge expired' }, { status: 400 });
			}

			const credential = (await request.json()) as
				| { id?: unknown; response?: { transports?: unknown } }
				| undefined;

			// Browser sends credential.id as base64url string - use directly
			const credentialID = credential?.id;

			if (!credentialID || typeof credentialID !== 'string') {
				log.error('[WebAuthn Auth] Invalid credential ID', { hasCredentialId: !!credentialID });
				return json({ error: 'Invalid credential ID' }, { status: 400 });
			}

			log.info('[WebAuthn Auth] Received credential for authentication', {
				hasCredentialId: true,
				keys: Object.keys(credential || {}).length,
				responseKeys: Object.keys((credential && credential.response) || {}).length
			});
			const usersKV = safeKV(env, 'BETA_USERS_KV')!;
			const credentialIDStr = credentialID as string;
			const userId = await getUserIdByCredentialID(usersKV, credentialIDStr);

			if (!userId) {
				log.error('[WebAuthn] Credential not found in index');
				return json({ error: 'Passkey not found' }, { status: 404 });
			}

			log.info('[WebAuthn] Found user for credential', { userFound: true });

			const authenticators = await getUserAuthenticators(usersKV, userId);
			log.info('[WebAuthn] User authenticators count', { count: authenticators.length });

			const authenticator = authenticators.find((auth) => auth.credentialID === credentialID);

			if (!authenticator) {
				log.error('[WebAuthn] Authenticator not in user list');
				return json({ error: 'Authenticator not found' }, { status: 404 });
			}

			log.info('[WebAuthn] Authenticator metadata', {
				hasCredentialID: !!authenticator.credentialID,
				credentialPublicKeyType: typeof authenticator.credentialPublicKey,
				credentialPublicKeyLength: authenticator.credentialPublicKey?.length,
				hasCounter: 'counter' in authenticator,
				hasTransports: !!authenticator.transports
			});

			const expectedOrigin = getOrigin(request);
			const expectedRPID = getRpID({ url: new URL(request.url) });

			// Convert stored base64url public key back to Uint8Array
			let credentialPublicKeyBytes: Uint8Array;
			try {
				if (
					!authenticator.credentialPublicKey ||
					typeof authenticator.credentialPublicKey !== 'string'
				) {
					log.error('[WebAuthn] Invalid credentialPublicKey type', {
						type: typeof authenticator.credentialPublicKey
					});
					return json({ error: 'Invalid stored public key format' }, { status: 500 });
				}

				credentialPublicKeyBytes = fromBase64Url(authenticator.credentialPublicKey);
				log.info('[WebAuthn] Converted public key back to Uint8Array', {
					length: credentialPublicKeyBytes.length
				});
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				log.error('[WebAuthn] Failed to convert public key from base64url', { message: msg });
				return json({ error: 'Invalid stored public key' }, { status: 500 });
			}

			// Prepare authenticator data for verification
			// credentialID stays as base64url string
			const authData = {
				credentialID: authenticator.credentialID, // Keep as string
				credentialPublicKey: credentialPublicKeyBytes, // Uint8Array
				counter: typeof authenticator.counter === 'number' ? authenticator.counter : 0,
				transports: authenticator.transports || [] // Add transports
			};

			log.info('[WebAuthn] Auth data prepared', {
				hasCredentialID: !!authData.credentialID,
				publicKeyLength: authData.credentialPublicKey.length,
				counter: authData.counter,
				transports: authData.transports
			});

			let verification;
			try {
				log.info('[WebAuthn] Verifying authentication response', {
					responseType: typeof credential,
					hasChallenge: !!expectedChallenge,
					expectedOrigin,
					expectedRPID,
					publicKeyIsUint8: authData.credentialPublicKey instanceof Uint8Array,
					counter: authData.counter
				});

				// Use the local wrapper which accepts base64url strings and does proper Buffer conversion
				verification = await verifyAuthenticationResponseForUser(
					credential,
					expectedChallenge,
					{
						credentialID: authData.credentialID,
						credentialPublicKey: toBase64Url(authData.credentialPublicKey),
						counter: authData.counter,
						transports: authData.transports
					},
					expectedOrigin,
					expectedRPID
				);
			} catch (e) {
				log.error('[WebAuthn] Verification threw error', {
					message: e instanceof Error ? e.message : String(e)
				});

				// Log minimal authData metadata for debugging without exposing secrets
				log.error('[WebAuthn] authData that caused error', {
					publicKeyLength: authData.credentialPublicKey.length,
					counter: authData.counter
				});

				// [!code fix] Issue #36: Don't expose error details to client
				return json({ error: 'Verification failed' }, { status: 400 });
			}

			if (!verification.verified) {
				log.warn('[WebAuthn] Verification failed - not verified');
				return json({ error: 'Authentication failed' }, { status: 400 });
			}

			log.info('[WebAuthn] Verification successful');
			log.info('[WebAuthn] authenticationInfo keys', {
				keys: Object.keys(verification.authenticationInfo || {})
			});

			const authInfo = verification.authenticationInfo as Record<string, unknown> | undefined;
			let newCounter = authData.counter + 1;
			if (authInfo) {
				const cand =
					(authInfo as Record<string, unknown>)['newCounter'] ??
					(authInfo as Record<string, unknown>)['counter'];
				if (typeof cand === 'number') newCounter = cand;
			}

			log.info('[WebAuthn] Updating authenticator counter', {
				from: authData.counter,
				to: newCounter
			});

			await updateAuthenticatorCounter(usersKV, userId, credentialID, newCounter);

			// ✅ CREATE SESSION - just like password login does!
			const fullUser = await findUserById(usersKV, userId);
			const now = new Date().toISOString();

			const sessionData = {
				id: userId,
				name: fullUser?.name || fullUser?.username || 'User',
				email: fullUser?.email || '',
				plan: fullUser?.plan || 'free',
				tripsThisMonth: fullUser?.tripsThisMonth || 0,
				maxTrips: fullUser?.maxTrips || 10,
				resetDate: fullUser?.resetDate || now,
				role:
					fullUser && typeof (fullUser as { role?: string }).role === 'string'
						? (fullUser as { role?: string }).role
						: 'user'
			};

			const sessionId = await createSession(sessionKv, sessionData);

			// Persist lastUsedCredentialID into the session object so devices can detect quick-sign preference
			try {
				const existing = await sessionKv.get(sessionId);
				if (existing) {
					const obj = typeof existing === 'string' ? JSON.parse(existing) : existing;
					obj.lastUsedCredentialID = credentialID;
					await sessionKv.put(sessionId, JSON.stringify(obj));
					log.info('[WebAuthn] Stored lastUsedCredentialID on session', { present: true });
				}
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				log.warn('[WebAuthn] Failed to persist lastUsedCredentialID on session', { message: msg });
			}

			cookies.set('session_id', sessionId, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax', // [!code fix] Changed from 'none' for CSRF protection
				secure: true,
				maxAge: 60 * 60 * 24 * 7
			});

			cookies.delete('webauthn-challenge', { path: '/' });

			log.info('[WebAuthn] Authentication successful - session created');
			return json({
				success: true,
				verified: true,
				user: sessionData,
				message: 'Authentication successful!'
			});
		}
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		log.error('[WebAuthn] POST Error', { message: msg });

		// [!code fix] Issue #36: Don't expose error details to client
		return json({ error: 'Verification failed' }, { status: 400 });
	}
};
