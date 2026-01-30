import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

let mockTripSvc: { permanentDelete: Mock };
let mockExpenseSvc: { permanentDelete: Mock };
let mockMileageSvc: { permanentDelete: Mock };
let mockTripKV: { get: Mock };
let mockExpenseKV: { get: Mock };
let mockMileageKV: { get: Mock };

vi.mock('$lib/server/tripService', () => ({
  makeTripService: () => mockTripSvc
}));

vi.mock('$lib/server/expenseService', () => ({
  makeExpenseService: () => mockExpenseSvc
}));

vi.mock('$lib/server/mileageService', () => ({
  makeMileageService: () => mockMileageSvc
}));

vi.mock('$lib/server/env', () => ({
  safeKV: (_env: unknown, name: string) => {
    if (name === 'BETA_LOGS_KV') return mockTripKV;
    if (name === 'BETA_EXPENSES_KV') return mockExpenseKV;
    if (name === 'BETA_MILEAGE_KV') return mockMileageKV;
    if (name === 'BETA_PLACES_KV') return undefined;
    return undefined;
  },
  safeDO: () => undefined
}));

vi.mock('$lib/server/user', () => ({
  getStorageId: (u: { id?: string }) => u.id || 'mock-storage-id'
}));

vi.mock('$lib/server/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('DELETE /api/trash/[id] handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTripSvc = { permanentDelete: vi.fn() };
    mockExpenseSvc = { permanentDelete: vi.fn() };
    mockMileageSvc = { permanentDelete: vi.fn() };
    mockTripKV = { get: vi.fn() };
    mockExpenseKV = { get: vi.fn() };
    mockMileageKV = { get: vi.fn() };
  });

  it('deletes only from mileage service when type=mileage is specified', async () => {
    const event = {
      request: {},
      locals: { user: { id: 'u1', name: 'testuser' } },
      platform: { env: {} },
      params: { id: 'test-id-123' },
      url: new URL('http://localhost/api/trash/test-id-123?type=mileage')
    } as unknown as Parameters<typeof import('./+server').DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockMileageSvc.permanentDelete).toHaveBeenCalledWith('u1', 'test-id-123');
    expect(mockTripSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockExpenseSvc.permanentDelete).not.toHaveBeenCalled();
  });

  it('deletes only from trip service when type=trip is specified', async () => {
    const event = {
      request: {},
      locals: { user: { id: 'u2', name: 'testuser2' } },
      platform: { env: {} },
      params: { id: 'trip-id-456' },
      url: new URL('http://localhost/api/trash/trip-id-456?type=trip')
    } as unknown as Parameters<typeof import('./+server').DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockTripSvc.permanentDelete).toHaveBeenCalledWith('u2', 'trip-id-456');
    expect(mockMileageSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockExpenseSvc.permanentDelete).not.toHaveBeenCalled();
  });

  it('deletes only from expense service when type=expense is specified', async () => {
    const event = {
      request: {},
      locals: { user: { id: 'u3', name: 'testuser3' } },
      platform: { env: {} },
      params: { id: 'expense-id-789' },
      url: new URL('http://localhost/api/trash/expense-id-789?type=expense')
    } as unknown as Parameters<typeof import('./+server').DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockExpenseSvc.permanentDelete).toHaveBeenCalledWith('u3', 'expense-id-789');
    expect(mockTripSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockMileageSvc.permanentDelete).not.toHaveBeenCalled();
  });

  it('detects and deletes mileage tombstone when no type is specified', async () => {
    // Mock that only mileage KV has a tombstone
    mockTripKV.get = vi.fn().mockResolvedValue(null);
    mockExpenseKV.get = vi.fn().mockResolvedValue(null);
    mockMileageKV.get = vi.fn().mockResolvedValue(
      JSON.stringify({
        deleted: true,
        id: 'mileage-id',
        userId: 'u4',
        miles: 100
      })
    );

    const event = {
      request: {},
      locals: { user: { id: 'u4', name: 'testuser4' } },
      platform: { env: {} },
      params: { id: 'mileage-id' },
      url: new URL('http://localhost/api/trash/mileage-id')
    } as unknown as Parameters<typeof import('./+server').DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockMileageSvc.permanentDelete).toHaveBeenCalledWith('u4', 'mileage-id');
    expect(mockTripSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockExpenseSvc.permanentDelete).not.toHaveBeenCalled();
  });

  it('detects and deletes trip tombstone when no type is specified', async () => {
    // Mock that only trip KV has a tombstone
    mockTripKV.get = vi.fn().mockResolvedValue(
      JSON.stringify({
        deleted: true,
        id: 'trip-id',
        userId: 'u5',
        startAddress: '123 Main St'
      })
    );
    mockExpenseKV.get = vi.fn().mockResolvedValue(null);
    mockMileageKV.get = vi.fn().mockResolvedValue(null);

    const event = {
      request: {},
      locals: { user: { id: 'u5', name: 'testuser5' } },
      platform: { env: {} },
      params: { id: 'trip-id' },
      url: new URL('http://localhost/api/trash/trip-id')
    } as unknown as Parameters<typeof DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockTripSvc.permanentDelete).toHaveBeenCalledWith('u5', 'trip-id');
    expect(mockMileageSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockExpenseSvc.permanentDelete).not.toHaveBeenCalled();
  });

  it('does not delete anything when no tombstone is found and no type specified', async () => {
    // Mock that no KV has a tombstone
    mockTripKV.get = vi.fn().mockResolvedValue(null);
    mockExpenseKV.get = vi.fn().mockResolvedValue(null);
    mockMileageKV.get = vi.fn().mockResolvedValue(null);

    const event = {
      request: {},
      locals: { user: { id: 'u6', name: 'testuser6' } },
      platform: { env: {} },
      params: { id: 'nonexistent-id' },
      url: new URL('http://localhost/api/trash/nonexistent-id')
    } as unknown as Parameters<typeof import('./+server').DELETE>[0];

    const { DELETE } = await import('./+server');
    const res = await DELETE(event);

    expect(res.status).toBe(204);
    expect(mockTripSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockMileageSvc.permanentDelete).not.toHaveBeenCalled();
    expect(mockExpenseSvc.permanentDelete).not.toHaveBeenCalled();
  });
});
