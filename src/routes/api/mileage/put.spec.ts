import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mocks are declared here so vitest's hoisting behaves predictably.
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

describe('PUT /api/mileage/[id] handler', () => {
  beforeEach(() => {
    mockSvc = {
      get: vi.fn(),
      put: vi.fn()
    };
    mockTripSvc = undefined;
  });

  it('respects an explicit miles value in the request body', async () => {
    const existing = { id: 'r1', userId: 'u1', startOdometer: 0, endOdometer: 0, miles: 0 };
    mockSvc.get.mockResolvedValue(existing);

    const body = { startOdometer: 0, endOdometer: 0, miles: 50 };

    const event = {
      params: { id: 'r1' },
      locals: { user: { id: 'u1' } },
      request: { json: async () => body },
      platform: {}
    };

    // import handler after mocks are in place
    const { PUT } = await import('./[id]/+server');
    const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.miles).toBeCloseTo(50, 6);
    const put = mockSvc.put! as ReturnType<typeof vi.fn>;
    expect(put).toHaveBeenCalled();
    const first = put.mock?.calls?.[0]?.[0] as { miles?: number } | undefined;
    expect(first).toBeTruthy();
    expect(first!.miles).toBeCloseTo(50, 6);
  });

  it('recomputes miles from odometers when miles is not provided', async () => {
    const existing = { id: 'r2', userId: 'u1', startOdometer: 10, endOdometer: 20, miles: 10 };
    mockSvc.get.mockResolvedValue(existing);

    const body = { startOdometer: 100, endOdometer: 160 };

    const event = {
      params: { id: 'r2' },
      locals: { user: { id: 'u1' } },
      request: { json: async () => body },
      platform: {}
    };

    // import handler after mocks are in place
    const { PUT } = await import('./[id]/+server');
    const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.miles).toBeCloseTo(60, 6);
    const put2 = mockSvc.put! as ReturnType<typeof vi.fn>;
    expect(put2).toHaveBeenCalled();
    const first2 = put2.mock?.calls?.[0]?.[0] as { miles?: number } | undefined;
    expect(first2).toBeTruthy();
    expect(first2!.miles).toBeCloseTo(60, 6);
  });

  it('also mirrors miles into the BETA_LOGS_KV trip record when present (best-effort)', async () => {
    const existing = { id: 'rt1', userId: 'u1', totalMiles: 5, mpg: 25, gasPrice: 3.5 };
    mockSvc.get.mockResolvedValue({ id: 'rt1', userId: 'u1', miles: 5, tripId: 'rt1' });

    // Prepare mocked trip service (module-level holder populated below)
    mockTripSvc = {
      get: vi.fn().mockResolvedValue(existing),
      put: vi.fn().mockResolvedValue(null)
    };

    const body = { miles: 77 };
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
    expect(json.miles).toBeCloseTo(77, 6);
    expect(mockSvc.put).toHaveBeenCalled();
    expect(mockTripSvc.get).toHaveBeenCalled();
    const tripPut = mockTripSvc!.put! as ReturnType<typeof vi.fn>;
    expect(tripPut).toHaveBeenCalled();
    const tfirst = tripPut.mock?.calls?.[0]?.[0] as { totalMiles?: number } | undefined;
    expect(tfirst).toBeTruthy();
    expect(tfirst!.totalMiles).toBeCloseTo(77, 6);
    // Verify fuelCost is also calculated (77 miles / 25 mpg * 3.5 gasPrice = 10.78)
    const tfc = tripPut.mock?.calls?.[0]?.[0] as { fuelCost?: number } | undefined;
    expect(tfc).toBeTruthy();
    expect(tfc!.fuelCost).toBeCloseTo(10.78, 2);
  });

  it('computes reimbursement when miles + rate are provided on PUT', async () => {
    const existing = { id: 'r3', userId: 'u1', miles: 0 };
    mockSvc.get.mockResolvedValue(existing);

    const body = { miles: 10, mileageRate: 0.725 };
    const event = {
      params: { id: 'r3' },
      locals: { user: { id: 'u1' } },
      request: { json: async () => body },
      platform: {}
    };

    const { PUT } = await import('./[id]/+server');
    const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.miles).toBeCloseTo(10, 6);
    expect(json.reimbursement).toBeCloseTo(7.25, 2);
    const put3 = mockSvc.put! as ReturnType<typeof vi.fn>;
    expect(put3).toHaveBeenCalled();
    const f3 = put3.mock?.calls?.[0]?.[0] as { reimbursement?: number } | undefined;
    expect(f3).toBeTruthy();
    expect(f3!.reimbursement).toBeCloseTo(7.25, 2);
  });
});
