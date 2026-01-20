import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services and env
let mockMillageSvc: any;
let mockTripKV: any;
let mockEnv: any;

vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => mockMillageSvc
}));

vi.mock('$lib/server/env', () => ({
	getEnv: () => mockEnv,
	safeKV: (_env: any, name: string) => {
		if (name === 'BETA_LOGS_KV') return mockTripKV;
		return {};
	},
	safeDO: () => ({})
}));

vi.mock('$lib/server/user', () => ({
	getStorageId: (user: any) => user?.id || 'test_user'
}));

describe('POST /api/mileage - Parent trip validation', () => {
	beforeEach(() => {
		mockMillageSvc = { put: vi.fn(), get: vi.fn() };
		mockTripKV = {
			get: vi.fn()
		};
		mockEnv = {};
	});

	it('returns 409 when parent trip does not exist (tripId provided)', async () => {
		// Mock: trip not found
		mockTripKV.get.mockResolvedValue(null);

		const tripId = '550e8400-e29b-41d4-a716-446655440000'; // valid UUID
		const body = {
			tripId,
			miles: 50,
			mileageRate: 0.725,
			startOdometer: 0,
			endOdometer: 50
		};
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);

		expect(res.status).toBe(409);
		const json = JSON.parse(await res.text());
		expect(json.error).toContain('Parent trip not found');
	});

	it('succeeds when no tripId provided (create standalone mileage)', async () => {
		// Mock: trip not found, but no tripId provided so validation should be skipped
		mockTripKV.get.mockResolvedValue(null);

		const body = {
			miles: 20,
			startOdometer: 100,
			endOdometer: 120
		};
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);

		expect(res.status).toBe(201);
		expect(mockMillageSvc.put).toHaveBeenCalled();
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
		mockTripKV.get.mockResolvedValue(JSON.stringify(deletedTrip));

		const body = {
			tripId: tripId,
			miles: 50,
			mileageRate: 0.725,
			startOdometer: 0,
			endOdometer: 50
		};
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);

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
		mockTripKV.get.mockResolvedValue(JSON.stringify(activeTrip));

		const body = {
			tripId: tripId,
			miles: 50,
			mileageRate: 0.725,
			startOdometer: 0,
			endOdometer: 50
		};
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);

		expect(res.status).toBe(201);
		expect(mockMillageSvc.put).toHaveBeenCalled();
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
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);

		expect(res.status).toBe(201);
		expect(mockMillageSvc.put).toHaveBeenCalled();
	});
});
