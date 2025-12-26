import { isoBase64URL } from '@simplewebauthn/server/helpers';

// Convert ArrayBuffer/Uint8Array/Buffer-like values to base64url string safely.
export function toBase64Url(input: any): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;

  // Accept objects produced by some runtimes (e.g., { type: 'Buffer', data: [...] })
  if (typeof input === 'object' && Array.isArray((input as any).data)) {
    try {
      const arr = (input as any).data as number[];
      const bytes = new Uint8Array(arr);
      if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return (globalThis as any).btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      throw new Error('Unsupported input shape for base64url conversion');
    }
  }

  let bytes: Uint8Array | undefined;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array((input as any).buffer, (input as any).byteOffset || 0, (input as any).byteLength || (input as any).length);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if ((input as any).buffer && (input as any).byteLength) {
    // fallback for exotic typed shapes
    try {
      bytes = new Uint8Array((input as any).buffer);
    } catch (e) {
      throw new Error('Unsupported input type for base64url conversion');
    }
  }

  if (!bytes) {
    throw new Error('Unsupported input type for base64url conversion');
  }

  // Convert to regular base64
  let base64: any;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else if (typeof btoa !== 'undefined') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  } else {
    // Last resort: manual conversion
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  }

  // Ensure we have a string before calling replace
  if (typeof base64 !== 'string') base64 = String(base64);

  try {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    throw new Error('Failed to convert to base64url: ' + (e && (e as Error).message));
  }
}

// Try to normalize credential ID into a base64url string (returns null on failure)
export function normalizeCredentialID(input: any): string | null {
  try {
    if (typeof input === 'string') {
      const s = input;
      if (/^[A-Za-z0-9_-]+$/.test(s) && s.length > 8) return s;
      return null;
    }

    // Node Buffer
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
      const b64 = Buffer.from(input).toString('base64');
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // Uint8Array / ArrayBuffer / TypedArray
    if (input instanceof Uint8Array || ArrayBuffer.isView(input) || input instanceof ArrayBuffer) {
      const u = input instanceof Uint8Array ? input : new Uint8Array((input as any).buffer || input);
      const buf = Buffer.from(u);
      const b64 = buf.toString('base64');
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // Shapes like { type: 'Buffer', data: [...] }
    if (input && typeof input === 'object' && Array.isArray((input as any).data)) {
      const arr = (input as any).data as number[];
      const buf = Buffer.from(arr);
      const b64 = buf.toString('base64');
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    return null;
  } catch (e) {
    console.warn('[WebAuthn Utils] normalizeCredentialID failed', e);
    return null;
  }
}

// A helper for Cloudflare KV: when storing credentialPublicKey/from Buffer-like shapes to a canonical base64url
export function credentialToBase64urlForStorage(input: any): string {
  // Prefer isoBase64URL helpers when possible for compatibility
  try {
    if (typeof input === 'string') return input;
    if ((input as any).buffer || (input as any).byteLength || Array.isArray((input as any).data) || Buffer.isBuffer(input)) {
      return toBase64Url(input);
    }
  } catch (e) {
    console.warn('[WebAuthn Utils] credentialToBase64urlForStorage failed', e);
  }

  throw new Error('Unable to coerse credential to base64url');
}