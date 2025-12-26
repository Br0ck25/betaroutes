import { describe, it, expect } from 'vitest';
import { toBase64Url, normalizeCredentialID, credentialToBase64urlForStorage } from './webauthn-utils';

describe('webauthn-utils', () => {
  it('converts regular base64 strings to base64url', () => {
    const b64 = 'A+/B/==';
    const res = toBase64Url(b64);
    expect(res).toBe('A-_B_');
  });

  it('passes through base64url strings unchanged', () => {
    const url = 'abc_123-XYZ';
    expect(toBase64Url(url)).toBe(url);
    expect(normalizeCredentialID(url)).toBe(url);
  });

  it('normalizes credential object fields for storage', () => {
    const cred = {
      id: 'A+/B/==',
      publicKey: new Uint8Array([1,2,3])
    } as any;

    const out = credentialToBase64urlForStorage(cred);
    expect(out.credentialID).toBe('A-_B_');
    expect(typeof out.credentialPublicKey).toBe('string');
  });
});
