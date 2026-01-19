import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services and env
let mockMillageSvc: any;
let mockTripKV: any;
let mockEnv: any;

vi.mock('$lib/server/millageService', () => ({
	makeMillageService: () => mockMillageSvc
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

describe('PUT /api/millage/[id] - Parent trip validation', () => {
	beforeEach(() => {
		mockMillageSvc = {
			put: vi.fn(),
			get: vi.fn().mockResolvedValue({
				id: 'trip-123',
				userId: 'u1',
				miles: 100,
				startOdometer: 0,
				endOdometer: 100
			})
		};
		mockTripKV = {
			get: vi.fn()
		};
		mockEnv = {};
	});

	it('returns 409 when parent trip does not exist', async () => {
		// Mock: trip not found
		mockTripKV.get.mockResolvedValue(null);

		const body = { miles: 150 };
		const event: any = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);

		expect(res.status).toBe(409);
		const json = JSON.parse(await res.text());
		expect(json.error).toContain('Parent trip not found');
	});

	it('returns 409 when parent trip is deleted', async () => {
		// Mock: trip exists but is deleted
		const deletedTrip = {
			id: 'trip-123',
			userId: 'u1',
			deleted: true,
			deletedAt: new Date().toISOString(),
			backup: {}
		};
		mockTripKV.get.mockResolvedValue(JSON.stringify(deletedTrip));

		const body = { miles: 150 };
		const event: any = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);

		expect(res.status).toBe(409);
		const json = JSON.parse(await res.text());
		expect(json.error).toContain('Parent trip is deleted');
	});

	it('succeeds when parent trip exists and is active', async () => {
		// Mock: trip exists and is active
		const activeTrip = {
			id: 'trip-123',
			userId: 'u1',
			title: 'Active Trip',
			totalMiles: 100
		};
		mockTripKV.get.mockResolvedValue(JSON.stringify(activeTrip));

		const body = { miles: 150 };
		const event: any = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);

		expect(res.status).toBe(200);
		expect(mockMillageSvc.put).toHaveBeenCalled();
	});

	it('skips validation when tripKV is not available', async () => {
		// Mock: tripKV returns empty object (no get method)
		mockTripKV = {};

		const body = { miles: 150 };
		const event: any = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as any);

		expect(res.status).toBe(200);
		expect(mockMillageSvc.put).toHaveBeenCalled();
	});
});
