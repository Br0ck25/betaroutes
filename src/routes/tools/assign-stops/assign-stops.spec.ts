import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

function makeKV(options?: { rlCount?: number; dmResponses?: string[] }) {
  const store = new Map<string, string>();
  let callIndex = 0;
  const calls: string[] = [];

  return {
    get: vi.fn(async (key: string) => {
      calls.push(key);
      // Rate limit probe
      if (key.startsWith('rl:optimize:v1:')) {
        if (typeof options?.rlCount === 'number') return JSON.stringify({ count: options.rlCount });
        return null;
      }

      // Sequential DM cache responses if provided
      if (key.startsWith('dm:') && Array.isArray(options?.dmResponses)) {
        callIndex += 1;
        const idx = callIndex - 1;
        if (idx < options!.dmResponses!.length) return options!.dmResponses![idx];
        return null;
      }

      return store.get(key) ?? null;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      calls.push(key);
      store.set(key, value);
    }),
    __calls: calls,
    __store: store
  };
}

describe('/tools/assign-stops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('success - small payload with points (200)', async () => {
    const kv = makeKV();
    const payload = {
      techs: [
        { name: 'Tech A', startLoc: { lat: 40.0, lon: -75.0 }, endLoc: { lat: 40.1, lon: -75.1 } }
      ],
      stops: [{ loc: { lat: 40.05, lon: -75.05 } }]
    };

    const event = {
      request: new Request('http://localhost/tools/assign-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      locals: { user: { id: 'u-test' } },
      platform: { env: { BETA_PLACES_KV: kv } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments?: Array<{ stops?: unknown[] }>;
      totals?: { miles: number; minutes: number };
    };
    expect(body.assignments).toBeDefined();
    const assignments = body.assignments!;
    expect(Array.isArray(assignments)).toBe(true);
    expect(assignments.length).toBe(1);
    expect(Array.isArray(assignments[0]?.stops)).toBe(true);
    expect(assignments[0]?.stops?.length ?? 0).toBe(1);
    expect(body.totals).toBeDefined();
    expect(typeof body.totals!.miles).toBe('number');
    expect(typeof body.totals!.minutes).toBe('number');
    // Ensure KV was used (cache reads/writes may or may not have happened) and keys include userId
    expect(kv.get).toHaveBeenCalled();
    expect(
      kv.__calls.some(
        (k) => k.includes(':u-test:') || k.startsWith('dm:') || k.startsWith('route:')
      )
    ).toBe(true);
  });

  it('geocode failure returns 400 when tech has no start', async () => {
    const kv = makeKV();
    const payload = { techs: [{ name: 'NoStart' }], stops: [{ loc: { lat: 40.1, lon: -75.1 } }] };

    const event = {
      request: new Request('http://localhost/tools/assign-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      locals: { user: { id: 'u-test' } },
      platform: { env: { BETA_PLACES_KV: kv } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Cannot geocode technician start');
  });

  it('rate-limit hit returns 429', async () => {
    const kv = makeKV({ rlCount: 8 }); // RL_MAX_PER_WINDOW is 8 in code
    const payload = {
      techs: [
        { name: 'Tech A', startLoc: { lat: 40.0, lon: -75.0 }, endLoc: { lat: 40.1, lon: -75.1 } }
      ],
      stops: [{ loc: { lat: 40.05, lon: -75.05 } }]
    };

    const event = {
      request: new Request('http://localhost/tools/assign-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      locals: { user: { id: 'u-test' } },
      platform: { env: { BETA_PLACES_KV: kv } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Rate limit exceeded');
  });

  it('uses DM cache ordering to affect assignment', async () => {
    // Simulate cached DM values that make tech 0 much closer than tech 1
    const dmResponses = [
      JSON.stringify({ distanceMeters: 100, durationSeconds: 60 }),
      JSON.stringify({ distanceMeters: 10000, durationSeconds: 3600 })
    ];
    const kv = makeKV({ dmResponses });

    const payload = {
      techs: [
        { name: 'Tech 0', startLoc: { lat: 40.0, lon: -75.0 }, endLoc: { lat: 40.1, lon: -75.1 } },
        { name: 'Tech 1', startLoc: { lat: 41.0, lon: -76.0 }, endLoc: { lat: 41.1, lon: -76.1 } }
      ],
      stops: [{ loc: { lat: 40.05, lon: -75.05 } }]
    };

    const event = {
      request: new Request('http://localhost/tools/assign-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      locals: { user: { id: 'u-test' } },
      platform: { env: { BETA_PLACES_KV: kv } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments?: Array<{ stops?: unknown[] }> };
    expect(body.assignments).toBeDefined();
    const assignments = body.assignments!;
    // Because DM cache made tech 0 much closer, it should get the stop
    expect(assignments[0]?.stops?.length ?? 0).toBe(1);
    expect(assignments[1]?.stops?.length ?? 0).toBe(0);
    // Ensure dm keys were looked up and included the userId in keys
    expect(kv.__calls.some((k) => k.startsWith('dm:u-test:'))).toBe(true);
  });

  it('rejects payloads exceeding MAX_TECHS', async () => {
    const kv = makeKV();
    const techs = Array.from({ length: 21 }).map((_, i) => ({
      name: `T${i}`,
      startLoc: { lat: 40 + i * 0.01, lon: -75 },
      endLoc: { lat: 40 + i * 0.02, lon: -75 }
    }));
    const payload = { techs, stops: [{ loc: { lat: 40.5, lon: -75.5 } }] };

    const event = {
      request: new Request('http://localhost/tools/assign-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      locals: { user: { id: 'u-test' } },
      platform: { env: { BETA_PLACES_KV: kv } }
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(event);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Maximum \d+ technicians allowed/);
  });
});
