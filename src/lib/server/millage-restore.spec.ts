import type { KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { describe, it, expect, beforeEach } from 'vitest';
import { setupMockKV } from '$lib/server/dev-mock-db';
import { makeMillageService } from '$lib/server/millageService';

describe('Mileage restore validation', () => {
	let platform: { env: Record<string, unknown> };

	beforeEach(() => {
		const event: { platform: { env: Record<string, unknown> } } = { platform: { env: {} } };
		setupMockKV(event);
		platform = event.platform;
	});

	it('blocks restore when parent trip is deleted', async () => {
		const millageKV = platform.env['BETA_MILLAGE_KV'] as unknown as KVNamespace;
		const tripKV = platform.env['BETA_LOGS_KV'] as unknown as KVNamespace;
		const tripIndexDO = platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace;

		const svc = makeMillageService(millageKV, tripIndexDO, tripKV);

		const userId = 'test_user_restore_blocked';
		const id = 'trip-millage-1';
		const now = new Date().toISOString();

		// Create a deleted trip (tombstone)
		const tripTombstone = {
			id,
			userId,
			deleted: true,
			deletedAt: now,
			backup: { id, userId, title: 'Deleted Trip', createdAt: now }
		};
		await tripKV.put(`trip:${userId}:${id}`, JSON.stringify(tripTombstone));

		// Create a deleted mileage record (tombstone)
		const millageTombstone = {
			id,
			userId,
			deleted: true,
			deletedAt: now,
			backup: {
				id,
				userId,
				miles: 50,
				createdAt: now,
				updatedAt: now,
				startOdometer: 0,
				endOdometer: 50
			}
		};
		await millageKV.put(`millage:${userId}:${id}`, JSON.stringify(millageTombstone));

		// Attempt to restore mileage when trip is deleted - should fail
		await expect(svc.restore(userId, id)).rejects.toThrow('Parent trip is deleted');
	});

	it('blocks restore when parent trip does not exist', async () => {
		const millageKV = platform.env['BETA_MILLAGE_KV'] as unknown as KVNamespace;
		const tripKV = platform.env['BETA_LOGS_KV'] as unknown as KVNamespace;
		const tripIndexDO = platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace;

		const svc = makeMillageService(millageKV, tripIndexDO, tripKV);

		const userId = 'test_user_no_trip';
		const id = 'millage-no-trip-1';
		const now = new Date().toISOString();

		// Create a deleted mileage record (tombstone) without any trip
		const millageTombstone = {
			id,
			userId,
			deleted: true,
			deletedAt: now,
			backup: {
				id,
				userId,
				miles: 25,
				createdAt: now,
				updatedAt: now,
				startOdometer: 0,
				endOdometer: 25
			}
		};
		await millageKV.put(`millage:${userId}:${id}`, JSON.stringify(millageTombstone));

		// Attempt to restore mileage when trip doesn't exist - should fail
		await expect(svc.restore(userId, id)).rejects.toThrow('Parent trip not found');
	});

	it('successfully restores mileage when parent trip is active', async () => {
		const millageKV = platform.env['BETA_MILLAGE_KV'] as unknown as KVNamespace;
		const tripKV = platform.env['BETA_LOGS_KV'] as unknown as KVNamespace;
		const tripIndexDO = platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace;

		const svc = makeMillageService(millageKV, tripIndexDO, tripKV);

		const userId = 'test_user_restore_ok';
		const id = 'trip-millage-2';
		const now = new Date().toISOString();

		// Create an active trip
		const trip = {
			id,
			userId,
			title: 'Active Trip',
			totalMiles: 0, // Miles were zeroed when mileage was deleted
			createdAt: now,
			updatedAt: now
		};
		await tripKV.put(`trip:${userId}:${id}`, JSON.stringify(trip));

		// Create a deleted mileage record (tombstone)
		const millageTombstone = {
			id,
			userId,
			deleted: true,
			deletedAt: now,
			backup: {
				id,
				userId,
				miles: 75,
				createdAt: now,
				updatedAt: now,
				startOdometer: 100,
				endOdometer: 175
			}
		};
		await millageKV.put(`millage:${userId}:${id}`, JSON.stringify(millageTombstone));

		// Restore should succeed
		const restored = await svc.restore(userId, id);
		expect(restored).toBeTruthy();
		expect(restored.miles).toBe(75);
		expect(restored.deleted).toBeUndefined();

		// Verify the trip's totalMiles was updated
		const tripRaw = await tripKV.get(`trip:${userId}:${id}`);
		expect(tripRaw).toBeTruthy();
		const updatedTrip = JSON.parse(tripRaw as string);
		expect(updatedTrip.totalMiles).toBe(75);
	});

	it('without tripKV, restore works but without validation', async () => {
		const millageKV = platform.env['BETA_MILLAGE_KV'] as unknown as KVNamespace;
		const tripIndexDO = platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace;

		// Create service WITHOUT tripKV
		const svc = makeMillageService(millageKV, tripIndexDO);

		const userId = 'test_user_no_validation';
		const id = 'millage-no-kv-1';
		const now = new Date().toISOString();

		// Create a deleted mileage record (tombstone)
		const millageTombstone = {
			id,
			userId,
			deleted: true,
			deletedAt: now,
			backup: {
				id,
				userId,
				miles: 30,
				createdAt: now,
				updatedAt: now,
				startOdometer: 0,
				endOdometer: 30
			}
		};
		await millageKV.put(`millage:${userId}:${id}`, JSON.stringify(millageTombstone));

		// Without tripKV, restore should work (no validation)
		const restored = await svc.restore(userId, id);
		expect(restored).toBeTruthy();
		expect(restored.miles).toBe(30);
	});

	it('delete sets parent trip totalMiles to 0', async () => {
		const millageKV = platform.env['BETA_MILLAGE_KV'] as unknown as KVNamespace;
		const tripKV = platform.env['BETA_LOGS_KV'] as unknown as KVNamespace;
		const tripIndexDO = platform.env['TRIP_INDEX_DO'] as unknown as DurableObjectNamespace;

		const svc = makeMillageService(millageKV, tripIndexDO, tripKV);

		const userId = 'test_user_delete';
		const id = 'trip-millage-delete-1';
		const now = new Date().toISOString();

		// Create an active trip with miles
		const trip = {
			id,
			userId,
			title: 'Trip with miles',
			totalMiles: 100,
			createdAt: now,
			updatedAt: now
		};
		await tripKV.put(`trip:${userId}:${id}`, JSON.stringify(trip));

		// Create an active mileage record
		const millageRecord = {
			id,
			userId,
			miles: 100,
			createdAt: now,
			updatedAt: now,
			startOdometer: 0,
			endOdometer: 100
		};
		await millageKV.put(`millage:${userId}:${id}`, JSON.stringify(millageRecord));

		// Delete the mileage
		await svc.delete(userId, id);

		// Verify the mileage is now a tombstone
		const millageRaw = await millageKV.get(`millage:${userId}:${id}`);
		expect(millageRaw).toBeTruthy();
		const millageTombstone = JSON.parse(millageRaw as string);
		expect(millageTombstone.deleted).toBe(true);
		expect(millageTombstone.backup.miles).toBe(100);

		// Verify the trip's totalMiles was set to 0
		const tripRaw = await tripKV.get(`trip:${userId}:${id}`);
		expect(tripRaw).toBeTruthy();
		const updatedTrip = JSON.parse(tripRaw as string);
		expect(updatedTrip.totalMiles).toBe(0);
	});
});
