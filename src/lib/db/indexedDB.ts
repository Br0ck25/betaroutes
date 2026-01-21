// src/lib/db/indexedDB.ts
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION } from './types';
import type { TripRecord, TrashRecord, SyncQueueItem, ExpenseRecord, MileageRecord } from './types';

/**
 * Database interface with typed stores
 */
export interface AppDB {
	trips: {
		key: string;
		value: TripRecord;
		indexes: {
			userId: string;
			syncStatus: string;
			updatedAt: string;
		};
	};
	expenses: {
		// [!code ++] New Store
		key: string;
		value: ExpenseRecord;
		indexes: {
			userId: string;
			syncStatus: string;
			date: string;
		};
	};
	trash: {
		key: string;
		value: TrashRecord;
		indexes: {
			userId: string;
			syncStatus: string;
			deletedAt: string;
			expiresAt: string;
		};
	};
	mileage: {
		key: string;
		value: MileageRecord;
		indexes: {
			userId: string;
			syncStatus: string;
			date: string;
		};
	};
	syncQueue: {
		key: number;
		value: SyncQueueItem;
		indexes: {
			timestamp: number;
			action: string;
			tripId: string;
		};
	};
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

/**
 * Open or create the IndexedDB database
 * * This creates 4 object stores:
 * - trips: Active trips
 * - expenses: Active expenses
 * - trash: Deleted items (30-day retention)
 * - syncQueue: Pending changes to sync to cloud
 */
export async function getDB(): Promise<IDBPDatabase<AppDB>> {
	if (dbPromise) {
		return dbPromise;
	}

	// Try opening the DB with the desired version. If the browser already has a newer
	// version (e.g. user has a DB from a different build), openDB will throw a
	// VersionError. In that case, fall back to opening the existing database
	// without requesting an upgrade to avoid the exception and continue using
	// the current schema.
	try {
		dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion, newVersion) {
				console.log(`📦 Upgrading database from v${oldVersion} to v${newVersion}`);

				// Create trips store
				if (!db.objectStoreNames.contains('trips')) {
					console.log('Creating "trips" object store...');
					const tripStore = db.createObjectStore('trips', { keyPath: 'id' });

					// Indexes for efficient queries
					tripStore.createIndex('userId', 'userId', { unique: false });
					tripStore.createIndex('syncStatus', 'syncStatus', { unique: false });
					tripStore.createIndex('updatedAt', 'updatedAt', { unique: false });

					console.log('✅ Created "trips" store with indexes');
				}

				// [!code ++] Create expenses store
				if (!db.objectStoreNames.contains('expenses')) {
					console.log('Creating "expenses" object store...');
					const expenseStore = db.createObjectStore('expenses', { keyPath: 'id' });

					// Indexes for efficient queries
					expenseStore.createIndex('userId', 'userId', { unique: false });
					expenseStore.createIndex('syncStatus', 'syncStatus', { unique: false });
					expenseStore.createIndex('date', 'date', { unique: false });

					console.log('✅ Created "expenses" store with indexes');
				}

				// Create trash store
				if (!db.objectStoreNames.contains('trash')) {
					console.log('Creating "trash" object store...');
					const trashStore = db.createObjectStore('trash', { keyPath: 'id' });

					// Indexes for efficient queries
					trashStore.createIndex('userId', 'userId', { unique: false });
					trashStore.createIndex('syncStatus', 'syncStatus', { unique: false });
					trashStore.createIndex('deletedAt', 'deletedAt', { unique: false });
					trashStore.createIndex('expiresAt', 'expiresAt', { unique: false });

					console.log('✅ Created "trash" store with indexes');
				}

				// [!code ++] Create mileage store
				if (!db.objectStoreNames.contains('mileage')) {
					console.log('Creating "mileage" object store...');
					const mileageStore = db.createObjectStore('mileage', { keyPath: 'id' });

					// Indexes for efficient queries
					mileageStore.createIndex('userId', 'userId', { unique: false });
					mileageStore.createIndex('syncStatus', 'syncStatus', { unique: false });
					mileageStore.createIndex('date', 'date', { unique: false });

					console.log('✅ Created "mileage" store with indexes');
				}

				// Create syncQueue store
				if (!db.objectStoreNames.contains('syncQueue')) {
					console.log('Creating "syncQueue" object store...');
					const queueStore = db.createObjectStore('syncQueue', {
						keyPath: 'id',
						autoIncrement: true
					});

					// Indexes
					queueStore.createIndex('timestamp', 'timestamp', { unique: false });
					queueStore.createIndex('action', 'action', { unique: false });
					queueStore.createIndex('tripId', 'tripId', { unique: false });

					console.log('✅ Created "syncQueue" store with indexes');
				}
			},

			blocked() {
				console.warn('⚠️ Database upgrade blocked - close other tabs');
			},

			blocking() {
				console.warn('⚠️ This tab is blocking database upgrade in another tab');
			}
		});

		// Force resolution now so VersionError is thrown inside the try block
		await dbPromise;

		// Migration: If an older DB used the legacy 'millage' store name, migrate its
		// data to the canonical 'mileage' store and drop the legacy store. We do this
		// after opening so we can read the old data, then perform a version upgrade
		// to create the new store and remove the old one.
		try {
			const db = await dbPromise;
			if (db.objectStoreNames.contains('millage') && !db.objectStoreNames.contains('mileage')) {
				console.log('🔁 Migrating legacy "millage" store to "mileage"...');
				// Read all entries from legacy store
				const readTx = db.transaction('millage', 'readonly');
				const oldItems = await readTx.objectStore('millage').getAll();
				await readTx.done;

				// Close current connection and bump DB version to perform structural upgrades
				db.close();
				const newVersion = (db.version || DB_VERSION) + 1;

				const migratedDB = await openDB<AppDB>(DB_NAME, newVersion, {
					upgrade(upDb) {
						if (!upDb.objectStoreNames.contains('mileage')) {
							console.log('Creating "mileage" store during migration...');
							const mileageStore = upDb.createObjectStore('mileage', { keyPath: 'id' });
							mileageStore.createIndex('userId', 'userId', { unique: false });
							mileageStore.createIndex('syncStatus', 'syncStatus', { unique: false });
							mileageStore.createIndex('date', 'date', { unique: false });
						}
						if (upDb.objectStoreNames.contains('millage')) {
							upDb.deleteObjectStore('millage');
							console.log('Deleted legacy "millage" store');
						}
					}
				});

				// Populate migrated store with old entries
				if (oldItems && oldItems.length > 0) {
					const writeTx = migratedDB.transaction('mileage', 'readwrite');
					const outStore = writeTx.objectStore('mileage');
					for (const itm of oldItems) {
						await outStore.put(itm as any);
					}
					await writeTx.done;
					console.log(`✅ Migrated ${oldItems.length} mileage records`);
				}

				// Replace the cached dbPromise with the migrated instance
				dbPromise = Promise.resolve(migratedDB);
			}
		} catch (migErr) {
			console.warn('⚠️ Mileage migration failed or not necessary:', migErr);
		}
	} catch (err: any) {
		if (
			err?.name === 'VersionError' ||
			(typeof DOMException !== 'undefined' &&
				err instanceof DOMException &&
				err.name === 'VersionError')
		) {
			console.warn(
				'⚠️ Database has a newer version than this code expects. Opening existing DB without upgrade.'
			);
			// Fallback: open at the existing database version without attempting to upgrade
			dbPromise = openDB<AppDB>(DB_NAME);
		} else {
			throw err;
		}
	}

	return dbPromise;
}

export function getMileageStoreName(db: IDBPDatabase<AppDB>): 'mileage' | 'millage' {
	if (db.objectStoreNames.contains('mileage')) return 'mileage';
	if (db.objectStoreNames.contains('millage')) return 'millage';
	return 'mileage';
}

/**
 * Clear all data from the database (useful for testing/debugging)
 */
export async function clearDatabase(): Promise<void> {
	const db = await getDB();

	// [!code ++] Added expenses to transaction
	const tx = db.transaction(['trips', 'expenses', 'mileage', 'trash', 'syncQueue'], 'readwrite');

	await Promise.all([
		tx.objectStore('trips').clear(),
		tx.objectStore('expenses').clear(),
		tx.objectStore('mileage').clear(),
		tx.objectStore('trash').clear(),
		tx.objectStore('syncQueue').clear()
	]);

	await tx.done;

	console.log('🗑️ Database cleared');
}

/**
 * Get database statistics
 */
export async function getDBStats() {
	const db = await getDB();

	// [!code ++] Added expenses
	const tx = db.transaction(['trips', 'expenses', 'mileage', 'trash', 'syncQueue'], 'readonly');

	const [tripCount, expenseCount, mileageCount, trashCount, queueCount] = await Promise.all([
		tx.objectStore('trips').count(),
		tx.objectStore('expenses').count(),
		tx.objectStore('mileage').count(),
		tx.objectStore('trash').count(),
		tx.objectStore('syncQueue').count()
	]);

	return {
		trips: tripCount,
		expenses: expenseCount,
		mileage: mileageCount,
		trash: trashCount,
		pendingSync: queueCount
	};
}

/**
 * Export all data (for backup/debugging)
 */
export async function exportData() {
	const db = await getDB();

	// [!code ++] Added expenses
	const tx = db.transaction(['trips', 'expenses', 'mileage', 'trash', 'syncQueue'], 'readonly');

	const [trips, expenses, mileage, trash, syncQueue] = await Promise.all([
		tx.objectStore('trips').getAll(),
		tx.objectStore('expenses').getAll(),
		tx.objectStore('mileage').getAll(),
		tx.objectStore('trash').getAll(),
		tx.objectStore('syncQueue').getAll()
	]);

	return {
		trips,
		expenses,
		mileage,
		trash,
		syncQueue,
		exportedAt: new Date().toISOString()
	};
}

/**
 * Import data (for restore/debugging)
 */
export async function importData(data: {
	trips?: TripRecord[];
	expenses?: ExpenseRecord[]; // [!code ++]
	mileage?: MileageRecord[];
	trash?: TrashRecord[];
	syncQueue?: SyncQueueItem[];
}) {
	const db = await getDB();

	const tx = db.transaction(['trips', 'expenses', 'mileage', 'trash', 'syncQueue'], 'readwrite');

	// Import trips
	if (data.trips) {
		const tripStore = tx.objectStore('trips');
		for (const trip of data.trips) {
			await tripStore.put(trip);
		}
	}

	// [!code ++] Import expenses and mileage
	if (data.expenses) {
		const expenseStore = tx.objectStore('expenses');
		for (const expense of data.expenses) {
			await expenseStore.put(expense);
		}
	}

	if (data.mileage) {
		const mileageStore = tx.objectStore('mileage');
		for (const m of data.mileage) {
			await mileageStore.put(m as any);
		}
	}

	// Import trash
	if (data.trash) {
		const trashStore = tx.objectStore('trash');
		for (const item of data.trash) {
			await trashStore.put(item);
		}
	}

	// Import sync queue
	if (data.syncQueue) {
		const queueStore = tx.objectStore('syncQueue');
		for (const item of data.syncQueue) {
			await queueStore.put(item);
		}
	}

	await tx.done;

	console.log('✅ Data imported successfully');
}

/**
 * Delete the entire database (nuclear option)
 */
export async function deleteDatabase(): Promise<void> {
	if (dbPromise) {
		const db = await dbPromise;
		db.close();
		dbPromise = null;
	}

	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => {
			console.log('🗑️ Database deleted');
			resolve();
		};
		request.onerror = () => reject(request.error);
		request.onblocked = () => {
			console.warn('⚠️ Database deletion blocked - close other tabs');
		};
	});
}
