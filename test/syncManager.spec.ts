import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { syncManager } from '$lib/sync/syncManager';

describe('syncManager store determination', () => {
	let originalApiCall: any;

	beforeEach(() => {
		originalApiCall = (syncManager as any).apiCall;
	});

	afterEach(() => {
		(syncManager as any).apiCall = originalApiCall;
	});

	it('routes trip-like payloads to /api/trips even if store hint is millage', async () => {
		const calls: any[] = [];
		(syncManager as any).apiCall = async (
			url: string,
			method: string,
			body: any,
			updateStore: any,
			id: string
		) => {
			calls.push({ url, method, body, updateStore, id });
		};

		const item = {
			action: 'create',
			tripId: 't-1',
			data: { id: 't-1', startAddress: '123 Main St', totalMiles: 12.4, store: 'millage' }
		};

		await (syncManager as any).processSyncItem(item as any);

		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe('/api/trips');
		expect(calls[0].updateStore).toBe('trips');
		expect(calls[0].body && calls[0].body.store).toBe('millage');
	});

	it('routes expense-like payloads to /api/expenses even without explicit store', async () => {
		const calls: any[] = [];
		(syncManager as any).apiCall = async (
			url: string,
			method: string,
			body: any,
			updateStore: any,
			id: string
		) => {
			calls.push({ url, method, body, updateStore, id });
		};

		const item = {
			action: 'create',
			tripId: 'e-1',
			data: { id: 'e-1', category: 'fuel', amount: 24.5 }
		};

		await (syncManager as any).processSyncItem(item as any);

		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe('/api/expenses');
		expect(calls[0].updateStore).toBe('expenses');
	});
});
