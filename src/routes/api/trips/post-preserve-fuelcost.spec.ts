import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockExpenseSvc!: { put: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn> };
let mockEnv: Record<string, unknown> | undefined;
let mockTripSvc!: {
	put: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
	list: ReturnType<typeof vi.fn>;
	checkMonthlyQuota: ReturnType<typeof vi.fn>;
	incrementUserCounter: ReturnType<typeof vi.fn>;
};

vi.mock('$lib/server/expenseService', () => ({
	makeExpenseService: () => mockExpenseSvc
}));
let mockMileageSvc: {
	list?: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	get?: ReturnType<typeof vi.fn>;
};
vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => mockMileageSvc
}));
vi.mock('$lib/server/tripService', () => ({
	makeTripService: () => mockTripSvc
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

describe('POST /api/trips preserves client fuelCost', () => {
	beforeEach(() => {
		mockExpenseSvc = {
			put: vi.fn().mockResolvedValue(undefined),
			get: vi.fn().mockResolvedValue(null)
		};
		mockTripSvc = {
			put: vi.fn().mockResolvedValue(undefined),
			get: vi.fn().mockResolvedValue(null),
			list: vi.fn().mockResolvedValue([]),
			checkMonthlyQuota: vi.fn().mockResolvedValue({ allowed: true, count: 0 }),
			incrementUserCounter: vi.fn().mockResolvedValue(undefined)
		};
		mockEnv = {
			BETA_EXPENSES_KV: {},
			BETA_MILEAGE_KV: {},
			BETA_USER_SETTINGS_KV: { get: vi.fn().mockResolvedValue(null) }
		};
		mockMileageSvc = {
			put: vi.fn().mockResolvedValue(undefined),
			list: vi.fn().mockResolvedValue([])
		};
	});

	it('does not overwrite a positive fuelCost provided by client', async () => {
		const body = {
			date: '2025-01-01',
			totalMiles: 26.6,
			mpg: 20,
			gasPrice: 0,
			fuelCost: 15
		};

		const event = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as unknown as Parameters<typeof POST>[0]);
		expect(res.status).toBe(201);
		const json = JSON.parse(await res.text());
		// returned trip should include the client-provided fuelCost
		expect(Number(json.fuelCost)).toBe(15);

		// Ensure stored trip (svc.put) was called with fuelCost preserved
		expect(mockTripSvc.put).toHaveBeenCalled();
		const firstCall = mockTripSvc.put.mock.calls[0];
		expect(firstCall).toBeDefined();
		const stored = (firstCall && firstCall[0]) as Record<string, unknown> | undefined;
		expect(stored).toBeDefined();
		expect(Number(stored!.fuelCost)).toBe(15);
		// MPG and gasPrice provided by client should also be persisted so later reads use them (avoid defaulting to 25/3.5)
		expect(Number(stored!.mpg)).toBe(20);
		expect(Number(stored!.gasPrice)).toBe(0);

		// --- Additional check: a subsequent GET (list) merging mileage should NOT overwrite user's fuelCost
		// Mock trip service list to return the stored trip and mileage service to return a mileage record
		mockTripSvc.list = vi.fn().mockResolvedValue([
			{
				id: (stored && stored.id) || 't1',
				userId: 'u1',
				date: stored?.date ?? '2025-01-01',
				fuelCost: Number(stored!.fuelCost),
				mpg: Number(stored!.mpg),
				gasPrice: Number(stored!.gasPrice),
				totalMiles: Number(stored!.totalMiles ?? 26.6)
			}
		]);

		// Mock mileage service to return a mileage record that could otherwise trigger recompute
		if (mockMileageSvc && mockMileageSvc.list) {
			mockMileageSvc.list = vi
				.fn()
				.mockResolvedValue([{ id: 'm1', tripId: (stored && stored.id) || 't1', miles: 26.6 }]);
		}

		// Call GET handler and ensure the trip still shows fuelCost 15
		const { GET } = await import('./+server');
		const getEvent = {
			request: { json: async () => ({}) },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv },
			url: { searchParams: new URLSearchParams() }
		};
		const getRes = await GET(getEvent as unknown as Parameters<typeof GET>[0]);
		expect(getRes.status).toBe(200);
		const list = JSON.parse(await getRes.text()) as Array<Record<string, unknown>>;
		expect(list.length).toBeGreaterThan(0);
		const first = list[0] as Record<string, unknown> | undefined;
		expect(first).toBeDefined();
		expect(Number(first!.fuelCost)).toBe(15);
	});
});
