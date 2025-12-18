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
  [key: string]: any;
  
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
// [!code change] Updated to support both Trip and Expense fields
export interface TrashRecord extends Partial<TripRecord>, Partial<ExpenseRecord> {
  id: string;
  userId: string;
  deletedAt: string;
  deletedBy: string;
  expiresAt: string;
  originalKey: string;
  recordType: 'trip' | 'expense'; // Added discriminator
}

/**
 * Sync queue item - tracks pending changes
 */
export interface SyncQueueItem {
  id?: number; // Auto-increment
  action: 'create' | 'update' | 'delete' | 'restore' | 'permanentDelete';
  tripId: string;
  data?: any;
  timestamp: number;
  retries: number;
  lastError?: string;
}

/**
 * Database schema version
 */
export const DB_VERSION = 2;
export const DB_NAME = 'go-route-yourself';