import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSvc: any;
let mockEnv: any;
vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => mockSvc
}));
vi.mock('$lib/server/env', () => ({
	getEnv: () => mockEnv,
	safeKV: (env: any, name: string) => {
		if (env && typeof env[name] !== 'undefined') return env[name];
		return {};
	},
	safeDO: () => ({})
}));

describe('POST /api/mileage handler', () => {
	beforeEach(() => {
		mockSvc = { put: vi.fn().mockResolvedValue(undefined), list: vi.fn().mockResolvedValue([]) };
		// Mock platform env: BETA_USERS_KV for findUserById and a context.waitUntil for background tasks
		mockEnv = {
			BETA_USERS_KV: {
				get: vi.fn().mockResolvedValue(
					JSON.stringify({
						id: 'u1',
						plan: 'free',
						username: 'u1',
						email: 'u1@example.com',
						password: 'pw',
						name: 'u1',
						createdAt: new Date().toISOString()
					})
				)
			}
		};
	});

	it('accepts miles + rate and computes reimbursement', async () => {
		const body = { miles: 50, mileageRate: 0.725 };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: { env: mockEnv, context: { waitUntil: vi.fn() } }
		};

		const { POST } = await import('./+server');
		const res = await POST(event as any);
		expect(res.status).toBe(201);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(50, 6);
		expect(json.reimbursement).toBeCloseTo(50 * 0.725, 2);
		expect(mockSvc.put).toHaveBeenCalled();
	});
});
