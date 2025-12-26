/**
 * WebAuthn utility functions for credential normalization and conversion
 */

/**
 * Convert various input types to base64url string safely
 */
export function toBase64Url(input: any): string {
  if (!input) return '';
  if (typeof input === 'string') return input;

  let bytes: Uint8Array;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(
      (input as any).buffer,
      (input as any).byteOffset || 0,
      (input as any).byteLength || (input as any).length
    );
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if ((input as any).buffer && (input as any).byteLength) {
    // fallback for exotic typed shapes
    try {
      bytes = new Uint8Array((input as any).buffer);
    } catch (e) {
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
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    } else {
      throw new Error('No base64 encoding method available');
    }
  } catch (e) {
    console.error('[webauthn-utils] Base64 encoding failed:', e);
    throw new Error('Failed to encode to base64');
  }

  if (typeof base64 !== 'string' || base64.length === 0) {
    console.error('[webauthn-utils] toBase64Url produced invalid output:', typeof base64, base64);
    throw new Error('Failed to convert to base64 string');
  }

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Normalize credential ID to base64url string format
 * Accepts strings (already base64url) or binary data
 */
export function normalizeCredentialID(credentialID: any): string {
  if (typeof credentialID === 'string') {
    // Already a string, validate it's base64url
    if (!/^[A-Za-z0-9_-]+$/.test(credentialID)) {
      throw new Error('Invalid base64url credential ID');
    }
    return credentialID;
  }
  
  // Convert binary to base64url
  return toBase64Url(credentialID);
}

/**
 * Convert credential data to base64url format for storage
 * Ensures both credentialID and credentialPublicKey are strings
 */
export function credentialToBase64urlForStorage(credential: {
  credentialID?: any;
  credentialPublicKey?: any;
  id?: any;
  publicKey?: any;
  [key: string]: any;
}): {
  credentialID: string;
  credentialPublicKey: string;
  [key: string]: any;
} {
  const credID = credential.credentialID || credential.id;
  const pubKey = credential.credentialPublicKey || credential.publicKey;

  if (!credID) {
    throw new Error('Missing credential ID');
  }
  if (!pubKey) {
    throw new Error('Missing credential public key');
  }

  return {
    ...credential,
    credentialID: normalizeCredentialID(credID),
    credentialPublicKey: toBase64Url(pubKey),
  };
}