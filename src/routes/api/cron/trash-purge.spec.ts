import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock the purge helper so we don't touch real KVs
vi.mock('$lib/server/trashPurge', () => ({
  purgeExpiredTrash: vi.fn()
}));

import * as purgeMod from '$lib/server/trashPurge';
import { POST, GET } from './trash-purge/+server';
import { log } from '$lib/server/log';

describe('/api/cron/trash-purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when missing or wrong secret', async () => {
    const event = {
      request: new Request('http://localhost/api/cron/trash-purge', { method: 'POST' }),
      platform: { env: { CRON_ADMIN_SECRET: 's3cr3t' } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('calls purgeExpiredTrash when authorized (POST)', async () => {
    const mockSummary = { checked: 3, deleted: 2, errors: 0 };
    (purgeMod.purgeExpiredTrash as Mock) = vi.fn().mockResolvedValue(mockSummary);

    const event = {
      request: new Request('http://localhost/api/cron/trash-purge', {
        method: 'POST',
        headers: { Authorization: 'Bearer s3cr3t' }
      }),
      platform: { env: { CRON_ADMIN_SECRET: 's3cr3t' } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      summary?: { checked: number; deleted: number; errors: number };
    };
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(mockSummary);
    expect(purgeMod.purgeExpiredTrash as Mock).toHaveBeenCalled();
  });

  it('calls purgeExpiredTrash when authorized (GET)', async () => {
    const mockSummary = { checked: 1, deleted: 0, errors: 0 };
    (purgeMod.purgeExpiredTrash as Mock).mockResolvedValue(mockSummary);

    const event = {
      request: new Request('http://localhost/api/cron/trash-purge', {
        method: 'GET',
        headers: { Authorization: 'Bearer s3cr3t' }
      }),
      platform: { env: { CRON_ADMIN_SECRET: 's3cr3t' } }
    } as unknown as Parameters<typeof GET>[0];

    const res = await GET(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success?: boolean;
      summary?: { checked: number; deleted: number; errors: number };
    };
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(mockSummary);
  });

  it('logs summary info on success', async () => {
    const mockSummary = { checked: 1, deleted: 1, errors: 0 };
    (purgeMod.purgeExpiredTrash as Mock).mockResolvedValue(mockSummary);
    const spy = vi.spyOn(log, 'info');

    const event = {
      request: new Request('http://localhost/api/cron/trash-purge', {
        method: 'POST',
        headers: { Authorization: 'Bearer s3cr3t' }
      }),
      platform: { env: { CRON_ADMIN_SECRET: 's3cr3t' } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('Cron: purgeExpiredTrash completed', { summary: mockSummary });
  });
});
