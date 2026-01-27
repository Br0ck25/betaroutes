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

describe('POST /api/trips (expense auto-create)', () => {
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

	it('creates fuel, maintenance, and supply expenses when provided', async () => {
		const body = {
			date: '2025-01-01',
			totalMiles: 10,
			fuelCost: 5.5,
			maintenanceItems: [{ type: 'Oil Change', cost: 12 }],
			suppliesItems: [{ type: 'Wire', cost: 3 }]
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
		expect(typeof json.id).toBe('string');

		// Verify expense creation calls
		expect(mockExpenseSvc.put).toHaveBeenCalled();
		const calls = (mockExpenseSvc.put as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
		const ids = calls.map((c) => c.id).sort();
		const expectedFuelId = `trip-fuel-${json.id}`;
		const expectedMaintId = `trip-maint-${json.id}-0`;
		const expectedSupplyId = `trip-supply-${json.id}-0`;
		expect(ids).toEqual(
			expect.arrayContaining([expectedFuelId, expectedMaintId, expectedSupplyId])
		);
	});
});
