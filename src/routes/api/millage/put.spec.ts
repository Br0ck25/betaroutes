import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PUT /api/millage/[id] handler', () => {
	let mockSvc: any;
	beforeEach(() => {
		mockSvc = {
			get: vi.fn(),
			put: vi.fn()
		};

		// mock makeMillageService to return the mock service
		vi.mock('$lib/server/millageService', () => ({
			makeMillageService: () => mockSvc
		}));

		// mock env helpers (no-op)
		vi.mock('$lib/server/env', () => ({
			getEnv: () => ({}),
			safeKV: () => ({}),
			safeDO: () => ({})
		}));
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
		const { PUT } = await import('./+server');
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
		const { PUT } = await import('./+server');
		const res = await PUT(event as any);
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.miles).toBeCloseTo(60, 6);
		expect(mockSvc.put).toHaveBeenCalled();
		expect(mockSvc.put.mock.calls[0][0].miles).toBeCloseTo(60, 6);
	});
});
