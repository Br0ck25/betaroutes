import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSvc!: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
let mockTripSvc: { get?: ReturnType<typeof vi.fn>; put?: ReturnType<typeof vi.fn> } | undefined;
vi.mock('$lib/server/mileageService', () => ({
  makeMileageService: () => mockSvc
}));
vi.mock('$lib/server/tripService', () => ({
  makeTripService: () => mockTripSvc
}));
vi.mock('$lib/server/env', () => ({
  getEnv: () => ({}),
  safeKV: () => ({}),
  safeDO: () => ({})
}));

describe('PUT /api/mileage/[id] preserves trip fuelCost if set', () => {
  beforeEach(() => {
    mockSvc = {
      get: vi.fn(),
      put: vi.fn()
    };
    mockTripSvc = undefined;
  });

  it("doesn't overwrite an existing positive trip.fuelCost when mileage updates", async () => {
    // Mileage record will be updated and linked to trip 'rt1'
    mockSvc.get.mockResolvedValue({ id: 'rt1', userId: 'u1', miles: 26.6, tripId: 'rt1' });

    // Prepare mocked trip service with an existing trip that has a user-provided fuelCost
    mockTripSvc = {
      get: vi.fn().mockResolvedValue({ id: 'rt1', userId: 'u1', totalMiles: 0, fuelCost: 15 }),
      put: vi.fn().mockResolvedValue(null)
    };

    const body = { miles: 26.6 };
    const event = {
      params: { id: 'rt1' },
      locals: { user: { id: 'u1' } },
      request: { json: async () => body },
      platform: {}
    };

    const { PUT } = await import('./[id]/+server');
    const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.miles).toBeCloseTo(26.6, 6);

    // Trip put should have been called, but fuelCost must remain 15
    expect(mockTripSvc!.put).toHaveBeenCalled();
    const tripPut = mockTripSvc!.put! as ReturnType<typeof vi.fn>;
    const putArg = tripPut.mock?.calls?.[0]?.[0] as { fuelCost?: number } | undefined;
    expect(putArg).toBeTruthy();
    expect(putArg!.fuelCost).toBe(15);
  });
});
