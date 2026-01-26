import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MileageRecord } from '$lib/server/mileageService';
import type { TripRecord } from '$lib/server/tripService';

type MockFn<T> = ReturnType<typeof vi.fn> & T;

type MockMileageService = {
	get: MockFn<(userId: string, id: string) => Promise<MileageRecord | null>>;
	delete: MockFn<(userId: string, id: string) => Promise<void>>;
	put?: MockFn<(item: MileageRecord) => Promise<void>>;
};

type MockTripService = {
	get: MockFn<(userId: string, id: string) => Promise<TripRecord | null>>;
	put: MockFn<(t: TripRecord) => Promise<void>>;
};

let mockSvc: MockMileageService = {
	get: vi.fn() as unknown as MockFn<(userId: string, id: string) => Promise<MileageRecord | null>>,
	delete: vi.fn() as unknown as MockFn<(userId: string, id: string) => Promise<void>>
};
let mockTripSvc: MockTripService | undefined;
vi.mock('$lib/server/mileageService', () => ({
	makeMileageService: () => mockSvc
}));
vi.mock('$lib/server/tripService', () => ({
	makeTripService: () => mockTripSvc
}));
vi.mock('$lib/server/env', () => ({
	getEnv: () => ({}),
	safeKV: () => ({}),
	safeDO: () => ({})
}));

beforeEach(() => {
	mockSvc = {
		get: vi.fn() as unknown as MockFn<
			(userId: string, id: string) => Promise<MileageRecord | null>
		>,
		delete: vi.fn() as unknown as MockFn<(userId: string, id: string) => Promise<void>>
	} as unknown as MockMileageService;
	mockTripSvc = undefined;
});

describe('DELETE /api/mileage/[id] handler', () => {
	it('zeros trip when mileage id equals trip id (legacy)', async () => {
		mockSvc.get.mockResolvedValue({ id: 'trip-legacy', userId: 'u1' });

		mockTripSvc = {
			get: vi.fn().mockResolvedValue({ id: 'trip-legacy', userId: 'u1', totalMiles: 100 }),
			put: vi.fn().mockResolvedValue(null)
		} as unknown as MockTripService;

		const event = {
			params: { id: 'trip-legacy' },
			locals: { user: { id: 'u1' } },
			platform: {}
		} as unknown as Parameters<typeof DELETE>[0];

		const { DELETE } = await import('./[id]/+server');
		const res = await DELETE(event as unknown as Parameters<typeof DELETE>[0]);
		expect(res.status).toBe(204);
		expect(mockSvc.delete).toHaveBeenCalledWith('u1', 'trip-legacy');
		expect(mockTripSvc!.get).toHaveBeenCalledWith('u1', 'trip-legacy');
		expect(mockTripSvc!.put).toHaveBeenCalled();
	});

	it('zeros trip when mileage has explicit tripId', async () => {
		mockSvc.get.mockResolvedValue({ id: 'm1', userId: 'u1', tripId: 'trip-123' });

		mockTripSvc = {
			get: vi.fn().mockResolvedValue({ id: 'trip-123', userId: 'u1', totalMiles: 50 }),
			put: vi.fn().mockResolvedValue(null)
		} as unknown as MockTripService;

		const event = {
			params: { id: 'm1' },
			locals: { user: { id: 'u1' } },
			platform: {}
		} as unknown as Parameters<typeof DELETE>[0];

		const { DELETE } = await import('./[id]/+server');
		const res = await DELETE(event as unknown as Parameters<typeof DELETE>[0]);
		expect(res.status).toBe(204);
		expect(mockSvc.delete).toHaveBeenCalledWith('u1', 'm1');
		expect(mockTripSvc!.get).toHaveBeenCalledWith('u1', 'trip-123');
		expect(mockTripSvc!.put).toHaveBeenCalled();
	});
});
