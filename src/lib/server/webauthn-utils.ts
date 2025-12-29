import { log } from '$lib/server/log';
/**
 * WebAuthn utility functions for credential normalization and conversion
 */

/**
 * Convert various input types to base64url string safely
 */
export function toBase64Url(input: unknown): string {
	if (!input) return '';
	if (typeof input === 'string') {
		// If the string is standard base64 (contains + / or =), convert it to base64url
		if (/[+/=]/.test(input)) {
			return String(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		}

		// Already looks like base64url
		if (/^[A-Za-z0-9_-]+$/.test(input)) return input;

		throw new Error('Unsupported string format for base64url conversion');
	}

	let bytes: Uint8Array;
	if (input instanceof Uint8Array) {
		bytes = input;
	} else if (ArrayBuffer.isView(input)) {
		const view = input as ArrayBufferView;
		const buf = (view as unknown as { buffer: ArrayBuffer }).buffer;
		const byteOffset = (view as unknown as { byteOffset?: number }).byteOffset ?? 0;
		const byteLength =
			(view as unknown as { byteLength?: number }).byteLength ??
			(view as unknown as { length?: number }).length ??
			0;
		bytes = new Uint8Array(buf, byteOffset, byteLength);
	} else if (input instanceof ArrayBuffer) {
		bytes = new Uint8Array(input);
	} else if (
		typeof input === 'object' &&
		input !== null &&
		'buffer' in input &&
		'byteLength' in (input as Record<string, unknown>)
	) {
		// fallback for exotic typed shapes
		try {
			bytes = new Uint8Array((input as unknown as { buffer: ArrayBuffer }).buffer);
		} catch {
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
			for (let i = 0; i < bytes.length; i++) {
				binary += String.fromCharCode(Number(bytes[i] ?? 0));
			}
			base64 = btoa(binary);
		} else {
			throw new Error('No base64 encoding method available');
		}
	} catch (err) {
		log.error('[webauthn-utils] Base64 encoding failed', { message: String(err) });
		throw new Error('Failed to encode to base64');
	}

	if (typeof base64 !== 'string' || base64.length === 0) {
		log.error('[webauthn-utils] toBase64Url produced invalid output', {
			type: typeof base64,
			preview: String(base64).slice(0, 100)
		});
		throw new Error('Failed to convert to base64 string');
	}

	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Normalize credential ID to base64url string format
 * Accepts strings (already base64url) or binary data
 */
export function normalizeCredentialID(credentialID: unknown): string {
	if (typeof credentialID === 'string') {
		// If string contains standard base64 characters, convert to base64url
		if (/[+/=]/.test(credentialID)) {
			return toBase64Url(credentialID);
		}
		// Already base64url-like? validate and return
		if (/^[A-Za-z0-9_-]+$/.test(credentialID)) {
			return credentialID;
		}
		throw new Error('Invalid credential ID format');
	}

	// Convert binary to base64url
	return toBase64Url(credentialID);
}

/**
 * Convert credential data to base64url format for storage
 * Ensures both credentialID and credentialPublicKey are strings
 */
export function credentialToBase64urlForStorage(credential: {
	credentialID?: unknown;
	credentialPublicKey?: unknown;
	id?: unknown;
	publicKey?: unknown;
	[key: string]: unknown;
}): {
	credentialID: string;
	credentialPublicKey: string;
	[key: string]: unknown;
} {
	const credID = credential.credentialID ?? credential.id;
	const pubKey = credential.credentialPublicKey ?? credential.publicKey;

	if (!credID) {
		throw new Error('Missing credential ID');
	}
	if (!pubKey) {
		throw new Error('Missing credential public key');
	}

	return {
		...credential,
		credentialID: normalizeCredentialID(credID),
		credentialPublicKey: toBase64Url(pubKey)
	};
}
