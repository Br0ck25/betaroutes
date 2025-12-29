// src/lib/db/indexedDB.ts
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION } from './types';
import type { TripRecord, TrashRecord, SyncQueueItem, ExpenseRecord } from './types';

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

			// Create sync queue store
			if (!db.objectStoreNames.contains('syncQueue')) {
				console.log('Creating "syncQueue" object store...');
				const syncQueue = db.createObjectStore('syncQueue', {
					keyPath: 'id',
					autoIncrement: true
				});

				// Indexes for efficient queries
				syncQueue.createIndex('timestamp', 'timestamp', { unique: false });
				syncQueue.createIndex('action', 'action', { unique: false });
				syncQueue.createIndex('tripId', 'tripId', { unique: false });

				console.log('✅ Created "syncQueue" store with indexes');
			}

			console.log('✅ Database upgrade complete');
		},

		blocked() {
			console.warn('⚠️ Database upgrade blocked - close other tabs');
		},

		blocking() {
			console.warn('⚠️ This tab is blocking database upgrade in another tab');
		}
	});

	return dbPromise;
}

/**
 * Clear all data from the database (useful for testing/debugging)
 */
export async function clearDatabase(): Promise<void> {
	const db = await getDB();

	// [!code ++] Added expenses to transaction
	const tx = db.transaction(['trips', 'expenses', 'trash', 'syncQueue'], 'readwrite');

	await Promise.all([
		tx.objectStore('trips').clear(),
		tx.objectStore('expenses').clear(),
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
	const tx = db.transaction(['trips', 'expenses', 'trash', 'syncQueue'], 'readonly');

	const [tripCount, expenseCount, trashCount, queueCount] = await Promise.all([
		tx.objectStore('trips').count(),
		tx.objectStore('expenses').count(),
		tx.objectStore('trash').count(),
		tx.objectStore('syncQueue').count()
	]);

	return {
		trips: tripCount,
		expenses: expenseCount,
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
	const tx = db.transaction(['trips', 'expenses', 'trash', 'syncQueue'], 'readonly');

	const [trips, expenses, trash, syncQueue] = await Promise.all([
		tx.objectStore('trips').getAll(),
		tx.objectStore('expenses').getAll(),
		tx.objectStore('trash').getAll(),
		tx.objectStore('syncQueue').getAll()
	]);

	return {
		trips,
		expenses,
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
	trash?: TrashRecord[];
	syncQueue?: SyncQueueItem[];
}) {
	const db = await getDB();

	const tx = db.transaction(['trips', 'expenses', 'trash', 'syncQueue'], 'readwrite');

	// Import trips
	if (data.trips) {
		const tripStore = tx.objectStore('trips');
		for (const trip of data.trips) {
			await tripStore.put(trip);
		}
	}

	// [!code ++] Import expenses
	if (data.expenses) {
		const expenseStore = tx.objectStore('expenses');
		for (const expense of data.expenses) {
			await expenseStore.put(expense);
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
