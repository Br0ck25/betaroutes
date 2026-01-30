import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { POST } from './+server';

vi.mock('$lib/server/authenticatorService', () => ({
  removeAuthenticator: vi.fn()
}));
vi.mock('$lib/server/auth', () => ({
  verifyPasswordForUser: vi.fn()
}));

import { removeAuthenticator } from '$lib/server/authenticatorService';
import { verifyPasswordForUser } from '$lib/server/auth';

function makeMockKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: async (k: string) => store.get(k),
    put: async (k: string, v: string) => store.set(k, v),
    delete: async (k: string) => store.delete(k)
  };
}

describe('/api/auth/webauthn/delete POST', () => {
  it('requires auth (401) when no user', async () => {
    const event = {
      request: new Request('http://localhost'),
      platform: { env: {} },
      cookies: { get: () => null },
      locals: {}
    } as unknown as Parameters<typeof POST>[0];
    const res = await POST(event);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('requires password (403) when missing', async () => {
    const cookies = { get: () => 'sess-1' };
    const event = {
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialID: 'c1' })
      }),
      platform: { env: { BETA_USERS_KV: {}, BETA_SESSIONS_KV: {} } },
      locals: { user: { id: 'u1' } },
      cookies
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { requiresPassword?: boolean };
    expect(body.requiresPassword).toBe(true);
  });

  it('rejects invalid password (401) and does not remove authenticator', async () => {
    (verifyPasswordForUser as Mock).mockResolvedValue(false);

    const event = {
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialID: 'c1', password: 'bad' })
      }),
      platform: { env: { BETA_USERS_KV: {}, BETA_SESSIONS_KV: {} } },
      locals: { user: { id: 'u1' } },
      cookies: { get: () => 'sess-1' }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(401);
    expect(removeAuthenticator).not.toHaveBeenCalled();
  });

  it('removes authenticator on valid password and clears session lastUsedCredentialID', async () => {
    (verifyPasswordForUser as Mock).mockResolvedValue(true);
    (removeAuthenticator as Mock).mockResolvedValue(undefined);

    const sessionsKV = makeMockKV({
      'sess-1': JSON.stringify({ lastUsedCredentialID: 'c1' })
    });

    const event = {
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialID: 'c1', password: 'good' })
      }),
      platform: { env: { BETA_USERS_KV: {}, BETA_SESSIONS_KV: sessionsKV } },
      locals: { user: { id: 'u1', email: 'u@x.com' } },
      cookies: { get: () => 'sess-1' }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean };
    expect(body.success).toBe(true);
    expect(removeAuthenticator).toHaveBeenCalledWith(expect.any(Object), 'u1', 'c1');

    // session should no longer have lastUsedCredentialID
    const s = await sessionsKV.get('sess-1');
    expect(s).toBeTruthy();
    const obj = JSON.parse(s as string);
    expect(obj.lastUsedCredentialID).toBeUndefined();
  });
});
