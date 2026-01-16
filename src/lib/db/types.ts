// src/lib/db/types.ts

/**
 * Sync status for items in IndexedDB
 */
export type SyncStatus = 'synced' | 'pending' | 'syncing' | 'error';

/**
 * Trip record stored in IndexedDB
 */
export interface TripRecord {
	id: string;
	userId: string;

	// Trip data
	date?: string;
	/** Optional pay date for tax purposes */
	payDate?: string;
	startTime?: string;
	endTime?: string;
	hoursWorked?: number;
	startAddress?: string;
	endAddress?: string;
	stops?: StopRecord[];
	totalMiles?: number;
	mpg?: number;
	gasPrice?: number;
	fuelCost?: number;

	notes?: string;

	// Custom fields
	[key: string]: unknown;

	// Metadata
	createdAt: string;
	updatedAt: string;
	syncStatus: SyncStatus;
	lastSyncedAt?: string;
}

/**
 * Stop within a trip
 */
export interface StopRecord {
	id: string;
	address: string;
	notes?: string;
	earnings?: number;
	order: number;
}

/**
 * General Expense record (Maintenance, Insurance, etc.)
 */
export interface ExpenseRecord {
	id: string;
	userId: string;

	date: string;
	category: string;
	amount: number;
	/** Whether this expense is tax-deductible */
	taxDeductible?: boolean;
	description?: string;

	// Metadata
	createdAt: string;
	updatedAt: string;
	syncStatus: SyncStatus;
	lastSyncedAt?: string;
}

/**
 * Trash item stored in IndexedDB
 */
export interface TrashRecord extends Partial<TripRecord>, Partial<ExpenseRecord> {
	id: string;
	userId: string;
	deletedAt: string;
	deletedBy: string;
	expiresAt: string;
	originalKey: string;
	recordType?: 'trip' | 'expense' | 'millage'; // Added discriminator
	[key: string]: unknown;
}

/**
 * Millage record stored in IndexedDB (client-side)
 */
export interface MillageRecord {
	id: string;
	userId: string;
	// Optional link back to a Trip record
	tripId?: string;
	date?: string;
	startOdometer: number;
	endOdometer: number;
	miles: number;
	// Optional vehicle name or id
	vehicle?: string;
	// Millage rate applied for this log (per mile)
	millageRate?: number;
	reimbursement?: number;
	notes?: string;
	// Metadata
	createdAt: string;
	updatedAt: string;
	syncStatus: SyncStatus;
	lastSyncedAt?: string;
	[key: string]: unknown;
}

/**
 * Sync queue item - tracks pending changes
 */
export interface SyncQueueItem {
	id?: number; // Auto-increment
	action: 'create' | 'update' | 'delete' | 'restore' | 'permanentDelete';
	tripId: string;
	data?: unknown;
	timestamp: number;
	retries: number;
	lastError?: string;
}

/**
 * Database schema version
 */
export const DB_VERSION = 4;
export const DB_NAME = 'go-route-yourself';
