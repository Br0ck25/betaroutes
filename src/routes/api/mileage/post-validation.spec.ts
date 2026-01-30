import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services and env
let mockMileageSvc!: {
  put: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
};
let mockTripKV!: { get?: ReturnType<typeof vi.fn> };
let mockEnv!: Record<string, unknown>;

vi.mock('$lib/server/mileageService', () => ({
  makeMileageService: () => mockMileageSvc
}));

vi.mock('$lib/server/env', () => ({
  getEnv: () => mockEnv,
  safeKV: (envParam: unknown, name: string) => {
    if (name === 'BETA_LOGS_KV') return mockTripKV;
    if (envParam && typeof (envParam as Record<string, unknown>)[name] !== 'undefined')
      return (envParam as Record<string, unknown>)[name];
    return {};
  },
  safeDO: () => ({})
}));

vi.mock('$lib/server/user', () => ({
  getStorageId: (user: unknown) => (user as { id?: string })?.id || 'test_user'
}));

describe('POST /api/mileage - Parent trip validation', () => {
  beforeEach(() => {
    mockMileageSvc = {
      put: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn()
    };
    mockTripKV = {
      get: vi.fn()
    };
    mockEnv = {};
    // Provide BETA_USERS_KV for user lookups
    (mockEnv as Record<string, unknown>)['BETA_USERS_KV'] = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          id: 'u1',
          plan: 'free',
          username: 'u1',
          email: 'u1@example.com',
          password: 'pw',
          name: 'u1',
          createdAt: new Date().toISOString()
        })
      )
    };
  });

  it('returns 409 when parent trip does not exist (tripId provided)', async () => {
    // Mock: trip not found
    mockTripKV.get!.mockResolvedValue(null);

    const tripId = '550e8400-e29b-41d4-a716-446655440000'; // valid UUID
    const body = {
      tripId,
      miles: 50,
      mileageRate: 0.725,
      startOdometer: 0,
      endOdometer: 50
    };
    const event = {
      request: { json: async () => body },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { POST } = await import('./+server');
    const res = await POST(event as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(409);
    const json = JSON.parse(await res.text());
    expect(json.error).toContain('Parent trip not found');
  });

  it('succeeds when no tripId provided (create standalone mileage)', async () => {
    // Mock: trip not found, but no tripId provided so validation should be skipped
    mockTripKV.get!.mockResolvedValue(null);

    const body = {
      miles: 20,
      startOdometer: 100,
      endOdometer: 120
    };
    const event = {
      request: { json: async () => body },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { POST } = await import('./+server');
    const res = await POST(event as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockMileageSvc.put).toHaveBeenCalled();
  });

  it('returns 409 when parent trip is deleted (tripId provided)', async () => {
    // Mock: trip exists but is deleted
    const tripId = '550e8400-e29b-41d4-a716-446655440001'; // valid UUID
    const deletedTrip = {
      id: tripId,
      userId: 'u1',
      deleted: true,
      deletedAt: new Date().toISOString(),
      backup: {}
    };
    mockTripKV.get!.mockResolvedValue(JSON.stringify(deletedTrip));

    const body = {
      tripId: tripId,
      miles: 50,
      mileageRate: 0.725,
      startOdometer: 0,
      endOdometer: 50
    };
    const event = {
      request: { json: async () => body },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { POST } = await import('./+server');
    const res = await POST(event as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(409);
    const json = JSON.parse(await res.text());
    expect(json.error).toContain('Parent trip is deleted');
  });

  it('succeeds when parent trip exists and is active (tripId provided)', async () => {
    // Mock: trip exists and is active
    const tripId = '550e8400-e29b-41d4-a716-446655440002'; // valid UUID
    const activeTrip = {
      id: tripId,
      userId: 'u1',
      title: 'Active Trip',
      totalMiles: 0
    };
    mockTripKV.get!.mockResolvedValue(JSON.stringify(activeTrip));

    const body = {
      tripId: tripId,
      miles: 50,
      mileageRate: 0.725,
      startOdometer: 0,
      endOdometer: 50
    };
    const event = {
      request: { json: async () => body },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { POST } = await import('./+server');
    const res = await POST(event as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockMileageSvc.put).toHaveBeenCalled();
  });

  it('skips validation when tripKV is not available (e.g., tests)', async () => {
    // Mock: tripKV returns empty object (no get method)
    mockTripKV = {};

    const body = {
      miles: 50,
      mileageRate: 0.725,
      startOdometer: 0,
      endOdometer: 50
    };
    const event = {
      request: { json: async () => body },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { POST } = await import('./+server');
    const res = await POST(event as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockMileageSvc.put).toHaveBeenCalled();
  });
});
