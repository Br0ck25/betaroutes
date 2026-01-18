import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSvc: any;
vi.mock('$lib/server/millageService', () => ({
	makeMillageService: () => mockSvc
}));
vi.mock('$lib/server/env', () => ({
	getEnv: () => ({}),
	safeKV: () => ({}),
	safeDO: () => ({})
}));

describe('POST /api/millage handler', () => {
	beforeEach(() => {
		mockSvc = { put: vi.fn() };
	});

	it('accepts miles + rate and computes reimbursement', async () => {
		const body = { miles: 50, millageRate: 0.725 };
		const event: any = {
			request: { json: async () => body },
			locals: { user: { id: 'u1' } },
			platform: {}
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
