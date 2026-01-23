// src/lib/utils/cleanup-orphaned-mileage.ts

/**
 * Utility to identify and remove orphaned mileage logs from IndexedDB.
 *
 * An orphaned mileage log is one where:
 * 1. It exists in IndexedDB but not in KV (server rejected it)
 * 2. Its parent trip doesn't exist
 * 3. DELETE operations return success but don't actually remove it
 *
 * This typically happens when:
 * - Parent trip was deleted but mileage log wasn't cleaned up
 * - Server rejected the mileage log creation but client still has it
 * - KV records were manually deleted outside the app
 */

import { getDB, getMileageStoreName } from '$lib/db/indexedDB';
import type { MileageRecord } from '$lib/db/types';

export interface OrphanCheckResult {
	totalMileage: number;
	orphaned: MileageRecord[];
	valid: MileageRecord[];
}

/**
 * Check for orphaned mileage logs by attempting to fetch from server.
 * Logs that return 404 from the server are considered orphaned.
 */
export async function identifyOrphanedMileage(userId: string): Promise<OrphanCheckResult> {
	console.log('🔍 identifyOrphanedMileage called with userId:', userId);

	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	console.log('📦 Using mileage store:', mileageStoreName);

	const tx = db.transaction(mileageStoreName, 'readonly');
	const store = tx.objectStore(mileageStoreName);

	// First, get ALL mileage records to see what we have
	const allRecords = await store.getAll();
	console.log(`📊 Total mileage records in IndexedDB (all users): ${allRecords.length}`);
	if (allRecords.length > 0) {
		console.log('Sample record:', allRecords[0]);
		console.log('UserIds in DB:', [...new Set(allRecords.map((r) => r.userId))]);
	}

	// Now get records for this specific user
	const index = store.index('userId');
	const allMileage = await index.getAll(userId);
	console.log(`📊 Mileage records for user '${userId}': ${allMileage.length}`);

	const orphaned: MileageRecord[] = [];
	const valid: MileageRecord[] = [];

	// Check each mileage log against the server
	for (const mileage of allMileage) {
		try {
			const response = await fetch(`/api/mileage/${mileage.id}`);

			if (response.status === 404) {
				// Server doesn't have this record - it's orphaned
				orphaned.push(mileage);
			} else if (response.ok) {
				// Server has it - it's valid
				valid.push(mileage);
			} else {
				// Other error - log but don't mark as orphaned (might be temporary issue)
				console.warn(`⚠️ Unexpected status ${response.status} for mileage ${mileage.id}`);
				valid.push(mileage); // Keep it for safety
			}
		} catch (error) {
			// Network error - don't mark as orphaned
			console.error(`❌ Failed to check mileage ${mileage.id}:`, error);
			valid.push(mileage); // Keep it for safety
		}
	}

	return {
		totalMileage: allMileage.length,
		orphaned,
		valid
	};
}

/**
 * Remove orphaned mileage logs from IndexedDB.
 * Returns the number of records removed.
 */
export async function removeOrphanedMileage(orphanedRecords: MileageRecord[]): Promise<number> {
	if (orphanedRecords.length === 0) {
		return 0;
	}

	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	const tx = db.transaction(mileageStoreName, 'readwrite');
	const store = tx.objectStore(mileageStoreName);

	let removed = 0;
	for (const record of orphanedRecords) {
		try {
			await store.delete(record.id);
			removed++;
			console.log(`🗑️ Removed orphaned mileage log: ${record.id}`);
		} catch (error) {
			console.error(`❌ Failed to remove orphaned mileage ${record.id}:`, error);
		}
	}

	await tx.done;

	return removed;
}

/**
 * Full cleanup: identify and remove all orphaned mileage logs.
 * Returns summary of what was removed.
 */
export async function cleanupOrphanedMileage(userId: string): Promise<{
	scanned: number;
	orphaned: number;
	removed: number;
	orphanedRecords: MileageRecord[];
}> {
	console.log('🔍 Scanning for orphaned mileage logs...');

	const result = await identifyOrphanedMileage(userId);

	console.log(`📊 Scan complete:
  - Total mileage logs: ${result.totalMileage}
  - Valid: ${result.valid.length}
  - Orphaned: ${result.orphaned.length}`);

	if (result.orphaned.length > 0) {
		console.log('🗑️ Removing orphaned records...');
		const removed = await removeOrphanedMileage(result.orphaned);
		console.log(`✅ Removed ${removed} orphaned mileage logs`);

		return {
			scanned: result.totalMileage,
			orphaned: result.orphaned.length,
			removed,
			orphanedRecords: result.orphaned
		};
	}

	return {
		scanned: result.totalMileage,
		orphaned: 0,
		removed: 0,
		orphanedRecords: []
	};
}

/**
 * Validate a single mileage log against the server.
 * Returns null if orphaned, the record if valid.
 */
export async function validateMileageRecord(mileageId: string): Promise<MileageRecord | null> {
	try {
		const response = await fetch(`/api/mileage/${mileageId}`);

		if (response.status === 404) {
			return null; // Orphaned
		}

		if (response.ok) {
			return await response.json();
		}

		// Other error - return null to be safe
		return null;
	} catch (error) {
		console.error(`❌ Failed to validate mileage ${mileageId}:`, error);
		return null;
	}
}
