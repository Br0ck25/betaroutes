import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the services and env
let mockMileageSvc!: { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
let mockTripKV!: { get?: ReturnType<typeof vi.fn> };
let mockEnv!: Record<string, unknown>;

vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => mockMileageSvc
}));

vi.mock('$lib/server/env', () => ({
	getEnv: () => mockEnv,
	safeKV: (_env: unknown, name: string) => {
		if (name === 'BETA_LOGS_KV') return mockTripKV;
		return {};
	},
	safeDO: () => ({})
}));

vi.mock('$lib/server/user', () => ({
	getStorageId: (user: unknown) => (user as { id?: string })?.id || 'test_user'
}));

describe('PUT /api/mileage/[id] - Parent trip validation', () => {
	beforeEach(() => {
		mockMileageSvc = {
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

	it('returns 409 when parent trip does not exist (attaching tripId)', async () => {
		// Mock: trip not found
		mockTripKV.get!.mockResolvedValue(null);

		const body = { miles: 150, tripId: 'trip-123' };
		const event = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);

		expect(res.status).toBe(409);
		const json = JSON.parse(await res.text());
		expect(json.error).toContain('Parent trip not found');
	});

	it('succeeds when updating a standalone mileage (no tripId)', async () => {
		// Mock: trip not found but existing mileage has no tripId so validation is skipped
		mockTripKV.get!.mockResolvedValue(null);

		const body = { miles: 150 };
		const event = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);

		expect(res.status).toBe(200);
		expect(mockMileageSvc.put).toHaveBeenCalled();
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
		mockTripKV.get!.mockResolvedValue(JSON.stringify(deletedTrip));

		const body = { miles: 150 };
		const event = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);

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
		mockTripKV.get!.mockResolvedValue(JSON.stringify(activeTrip));

		const body = { miles: 150 };
		const event = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);

		expect(res.status).toBe(200);
		expect(mockMileageSvc.put).toHaveBeenCalled();
	});

	it('skips validation when tripKV is not available', async () => {
		// Mock: tripKV returns empty object (no get method)
		mockTripKV = {} as { get?: ReturnType<typeof vi.fn> };

		const body = { miles: 150 };
		const event = {
			params: { id: 'trip-123' },
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv }
		};

		const { PUT } = await import('./[id]/+server');
		const res = await PUT(event as unknown as Parameters<typeof PUT>[0]);

		expect(res.status).toBe(200);
		expect(mockMileageSvc.put).toHaveBeenCalled();
	});
});
