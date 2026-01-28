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
vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => ({ put: vi.fn().mockResolvedValue(undefined) })
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
	});
});
