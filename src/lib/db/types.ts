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
 * Trash item stored in IndexedDB
 */
export interface TrashRecord extends TripRecord {
  deletedAt: string;
  deletedBy: string;
  expiresAt: string;
  originalKey: string;
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
export const DB_VERSION = 1;
export const DB_NAME = 'go-route-yourself';
