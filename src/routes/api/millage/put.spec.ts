import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mocks are declared here so vitest's hoisting behaves predictably.
let mockSvc: any;
let mockTripSvc: any;
vi.mock('$lib/server/millageService', () => ({
	makeMillageService: () => mockSvc
}));
vi.mock('$lib/server/tripService', () => ({
	makeTripService: () => mockTripSvc
}));
vi.mock('$lib/server/env', () => ({
	getEnv: () => ({}),
	safeKV: () => ({}),
	safeDO: () => ({})
}));

describe('PUT /api/millage/[id] handler', () => {
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

		const event: any = {
			params: { id: 'r1' },
			locals: { user: { id: 'u1' } },
			request: { json: async () => body },
			platform: {}
		};

		// import handler after mocks are in place
		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(50, 6);
		expect(mockSvc.put).toHaveBeenCalled();
		expect(mockSvc.put.mock.calls[0][0].miles).toBeCloseTo(50, 6);
	});

	it('recomputes miles from odometers when miles is not provided', async () => {
		const existing = { id: 'r2', userId: 'u1', startOdometer: 10, endOdometer: 20, miles: 10 };
		mockSvc.get.mockResolvedValue(existing);

		const body = { startOdometer: 100, endOdometer: 160 };

		const event: any = {
			params: { id: 'r2' },
			locals: { user: { id: 'u1' } },
			request: { json: async () => body },
			platform: {}
		};

		// import handler after mocks are in place
		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(60, 6);
		expect(mockSvc.put).toHaveBeenCalled();
		expect(mockSvc.put.mock.calls[0][0].miles).toBeCloseTo(60, 6);
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
		const event: any = {
			params: { id: 'rt1' },
			locals: { user: { id: 'u1' } },
			request: { json: async () => body },
			platform: {}
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(77, 6);
		expect(mockSvc.put).toHaveBeenCalled();
		expect(mockTripSvc.get).toHaveBeenCalled();
		expect(mockTripSvc.put).toHaveBeenCalled();
		expect(mockTripSvc.put.mock.calls[0][0].totalMiles).toBeCloseTo(77, 6);
		// Verify fuelCost is also calculated (77 miles / 25 mpg * 3.5 gasPrice = 10.78)
		expect(mockTripSvc.put.mock.calls[0][0].fuelCost).toBeCloseTo(10.78, 2);
	});

	it('computes reimbursement when miles + rate are provided on PUT', async () => {
		const existing = { id: 'r3', userId: 'u1', miles: 0 };
		mockSvc.get.mockResolvedValue(existing);

		const body = { miles: 10, millageRate: 0.725 };
		const event: any = {
			params: { id: 'r3' },
			locals: { user: { id: 'u1' } },
			request: { json: async () => body },
			platform: {}
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(10, 6);
		expect(json.reimbursement).toBeCloseTo(7.25, 2);
		expect(mockSvc.put).toHaveBeenCalled();
		expect(mockSvc.put.mock.calls[0][0].reimbursement).toBeCloseTo(7.25, 2);
	});
});
