// src/lib/utils/debug-helpers.ts

/**
 * Debug helpers for troubleshooting data issues in the browser console.
 *
 * Usage in browser console:
 * ```javascript
 * // Import the helpers (if using dev tools)
 * const helpers = await import('/$lib/utils/debug-helpers');
 *
 * // Or access via window (if exposed in +layout.svelte)
 * window.debugGRY.listOrphanedMileage();
 * window.debugGRY.clearOrphanedMileage();
 * window.debugGRY.showDBStats();
 * ```
 */

import { getDB, getDBStats, getMileageStoreName } from '$lib/db/indexedDB';
import { cleanupOrphanedMileage, identifyOrphanedMileage } from './cleanup-orphaned-mileage';
import type { MileageRecord } from '$lib/db/types';

/**
 * List all mileage logs in IndexedDB with their sync status.
 */
export async function listAllMileage(): Promise<void> {
	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	const tx = db.transaction(mileageStoreName, 'readonly');
	const store = tx.objectStore(mileageStoreName);
	const allMileage = await store.getAll();

	console.group('📊 All Mileage Logs in IndexedDB');
	console.table(
		allMileage.map((m) => ({
			id: m.id.substring(0, 8) + '...',
			userId: m.userId,
			date: m.date,
			miles: m.miles,
			syncStatus: (m as any).syncStatus || 'unknown',
			tripId: m.tripId ? m.tripId.substring(0, 8) + '...' : 'none'
		}))
	);
	console.log(`Total: ${allMileage.length} records`);
	console.groupEnd();
}

/**
 * Check which mileage logs are orphaned (not in KV).
 */
export async function listOrphanedMileage(userId: string): Promise<void> {
	console.log('🔍 Scanning for orphaned mileage logs...');

	const result = await identifyOrphanedMileage(userId);

	console.group('🗑️ Orphaned Mileage Logs');
	console.log(`Total mileage logs: ${result.totalMileage}`);
	console.log(`Valid: ${result.valid.length}`);
	console.log(`Orphaned: ${result.orphaned.length}`);

	if (result.orphaned.length > 0) {
		console.table(
			result.orphaned.map((m) => ({
				id: m.id.substring(0, 8) + '...',
				date: m.date,
				miles: m.miles,
				tripId: m.tripId ? m.tripId.substring(0, 8) + '...' : 'none',
				syncStatus: (m as any).syncStatus || 'unknown'
			}))
		);
		console.warn('⚠️ Call window.debugGRY.clearOrphanedMileage() to remove these orphaned records');
	} else {
		console.log('✅ No orphaned records found!');
	}

	console.groupEnd();
}

/**
 * Remove orphaned mileage logs from IndexedDB.
 */
export async function clearOrphanedMileage(userId: string): Promise<void> {
	const result = await cleanupOrphanedMileage(userId);

	console.group('🗑️ Orphaned Mileage Cleanup');
	console.log(`Scanned: ${result.scanned} records`);
	console.log(`Orphaned: ${result.orphaned} records`);
	console.log(`Removed: ${result.removed} records`);

	if (result.removed > 0) {
		console.log('✅ Cleanup complete! Reload the page to see updated data.');
	} else {
		console.log('✅ No orphaned records to remove.');
	}

	console.groupEnd();
}

/**
 * Show IndexedDB statistics.
 */
export async function showDBStats(): Promise<void> {
	const stats = await getDBStats();

	console.group('📊 IndexedDB Statistics');
	console.table(stats);
	console.groupEnd();
}

/**
 * Check a specific mileage log against the server.
 */
export async function checkMileageOnServer(mileageId: string): Promise<void> {
	console.log(`🔍 Checking mileage log ${mileageId} on server...`);

	try {
		const response = await fetch(`/api/mileage/${mileageId}`);

		console.group(`Mileage ${mileageId}`);
		console.log(`Status: ${response.status} ${response.statusText}`);

		if (response.status === 404) {
			console.warn('⚠️ Record NOT found on server (orphaned)');
		} else if (response.ok) {
			const data = await response.json();
			console.log('✅ Record exists on server:');
			console.table(data);
		} else {
			console.error('❌ Unexpected response:', response.status);
		}

		console.groupEnd();
	} catch (error) {
		console.error('❌ Network error:', error);
	}
}

/**
 * Get a specific mileage log from IndexedDB.
 */
export async function getMileageFromIndexedDB(mileageId: string): Promise<MileageRecord | null> {
	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	const tx = db.transaction(mileageStoreName, 'readonly');
	const store = tx.objectStore(mileageStoreName);

	try {
		const record = await store.get(mileageId);
		if (record) {
			console.log('✅ Found in IndexedDB:');
			console.table(record);
			return record;
		} else {
			console.warn('⚠️ Not found in IndexedDB');
			return null;
		}
	} catch (error) {
		console.error('❌ Error reading from IndexedDB:', error);
		return null;
	}
}

/**
 * Force delete a mileage log from IndexedDB (nuclear option).
 */
export async function forceDeleteFromIndexedDB(mileageId: string): Promise<void> {
	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	const tx = db.transaction(mileageStoreName, 'readwrite');
	const store = tx.objectStore(mileageStoreName);

	try {
		await store.delete(mileageId);
		await tx.done;
		console.log(`✅ Forcibly deleted ${mileageId} from IndexedDB`);
		console.log('🔄 Reload the page to see updated data.');
	} catch (error) {
		console.error('❌ Error deleting from IndexedDB:', error);
	}
}

/**
 * Compare IndexedDB vs Server for all mileage logs.
 */
export async function auditMileageSync(userId: string): Promise<void> {
	console.log('🔍 Auditing mileage sync between IndexedDB and server...');

	const db = await getDB();
	const mileageStoreName = getMileageStoreName(db);
	const tx = db.transaction(mileageStoreName, 'readonly');
	const store = tx.objectStore(mileageStoreName);
	const index = store.index('userId');
	const localMileage = await index.getAll(userId);

	console.log(`📦 Found ${localMileage.length} mileage logs in IndexedDB`);

	const issues: Array<{ id: string; issue: string }> = [];

	for (const mileage of localMileage) {
		try {
			const response = await fetch(`/api/mileage/${mileage.id}`);

			if (response.status === 404) {
				issues.push({ id: mileage.id, issue: 'Not on server (orphaned)' });
			} else if (!response.ok) {
				issues.push({ id: mileage.id, issue: `Server error: ${response.status}` });
			}
		} catch {
			issues.push({ id: mileage.id, issue: 'Network error' });
		}
	}

	console.group('🔍 Audit Results');
	console.log(`Total mileage logs: ${localMileage.length}`);
	console.log(`Issues found: ${issues.length}`);

	if (issues.length > 0) {
		console.table(issues);
		console.warn('⚠️ Call window.debugGRY.clearOrphanedMileage() to fix orphaned records');
	} else {
		console.log('✅ All mileage logs are in sync!');
	}

	console.groupEnd();
}

/**
 * Export all debug helpers for easy access.
 */
export const debugHelpers = {
	listAllMileage,
	listOrphanedMileage,
	clearOrphanedMileage,
	showDBStats,
	checkMileageOnServer,
	getMileageFromIndexedDB,
	forceDeleteFromIndexedDB,
	auditMileageSync
};

// Expose to window for easy console access (always available, not just in dev)
if (typeof window !== 'undefined') {
	(window as any).debugGRY = debugHelpers;
	console.log(
		'🛠️ Debug helpers loaded. Available commands:',
		Object.keys(debugHelpers).map((k) => `window.debugGRY.${k}()`)
	);
}
