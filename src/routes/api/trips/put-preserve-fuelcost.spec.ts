import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockEnv: Record<string, unknown> | undefined;
let mockTripSvc!: {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  checkMonthlyQuota: ReturnType<typeof vi.fn>;
  incrementUserCounter: ReturnType<typeof vi.fn>;
};

vi.mock('$lib/server/expenseService', () => ({
  makeExpenseService: () => ({
    list: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined)
  })
}));
vi.mock('$lib/server/tripService', () => ({
  makeTripService: () => mockTripSvc
}));
let mockMileageSvc: {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};
vi.mock('$lib/server/mileageService', () => ({
  makeMileageService: () => mockMileageSvc
}));
vi.mock('$lib/server/userService', () => ({
  findUserById: () => Promise.resolve({ id: 'u1', plan: 'free' })
}));
vi.mock('$lib/server/env', () => ({
  getEnv: () => mockEnv,
  safeKV: (env: unknown, name: string) => {
    if (env && typeof (env as Record<string, unknown>)[name] !== 'undefined')
      return (env as Record<string, unknown>)[name];
    return {};
  },
  safeDO: () => ({})
}));

describe('PUT /api/trips/:id preserves existing fuelCost', () => {
  beforeEach(() => {
    mockTripSvc = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({
        id: 'trip-1',
        userId: 'u1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalMiles: 0,
        fuelCost: 15
      }),
      list: vi.fn().mockResolvedValue([]),
      checkMonthlyQuota: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
      incrementUserCounter: vi.fn().mockResolvedValue(undefined)
    };
    mockMileageSvc = {
      list: vi.fn().mockResolvedValue([{ id: 'm1', tripId: 'trip-1', miles: 26.6 }]),
      get: vi.fn().mockResolvedValue({ id: 'm1', tripId: 'trip-1', miles: 26.6 }),
      put: vi.fn().mockResolvedValue(undefined)
    };
    mockEnv = {
      BETA_MILEAGE_KV: {},
      BETA_EXPENSES_KV: {},
      BETA_USER_SETTINGS_KV: { get: vi.fn().mockResolvedValue(null) }
    };
  });

  it('does not overwrite an existing positive fuelCost when updating miles', async () => {
    const body = { id: 'trip-1', totalMiles: 26.6 };
    const event = {
      request: { json: async () => body },
      params: { id: 'trip-1' },
      locals: { user: { id: 'u1' } },
      platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
    };

    const { PUT } = await import('./[id]/+server');
    const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    // Response should not stomp on existing fuelCost
    expect(Number(json.fuelCost)).toBe(15);

    // Ensure that the trip was persisted and the last persisted copy still has fuelCost 15
    expect(mockTripSvc.put).toHaveBeenCalled();
    // Use a strongly-typed call array to avoid `any` (vitest mock.calls is an array of arg arrays)
    const calls = ((mockTripSvc.put as ReturnType<typeof vi.fn>).mock.calls ?? []) as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1]![0] as Record<string, unknown>;
    expect(Number(last.fuelCost)).toBe(15);
  });
});
