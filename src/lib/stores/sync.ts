// src/lib/stores/sync.ts
import { writable, derived } from 'svelte/store';

/**
 * Sync status types
 */
export type SyncStatusType = 'synced' | 'syncing' | 'offline' | 'pending' | 'error';

/**
 * Sync state interface
 */
export interface SyncState {
  status: SyncStatusType;
  online: boolean;
  lastSyncAt?: string;
  pendingCount: number;
  errorMessage?: string;
}

/**
 * Create sync status store
 */
function createSyncStore() {
  const { subscribe, set, update } = writable<SyncState>({
    status: 'synced',
    online: navigator.onLine,
    pendingCount: 0,
  });

  return {
    subscribe,

    /**
     * Set online status
     */
    setOnline(online: boolean) {
      update(state => ({
        ...state,
        online,
        status: online ? 'synced' : 'offline',
      }));
    },

    /**
     * Set syncing status
     */
    setSyncing() {
      update(state => ({
        ...state,
        status: 'syncing',
      }));
    },

    /**
     * Set synced status
     */
    setSynced() {
      update(state => ({
        ...state,
        status: 'synced',
        lastSyncAt: new Date().toISOString(),
        pendingCount: 0,
        errorMessage: undefined,
      }));
    },

    /**
     * Set pending status
     */
    setPending(count: number) {
      update(state => ({
        ...state,
        status: state.online ? 'pending' : 'offline',
        pendingCount: count,
      }));
    },

    /**
     * Set error status
     */
    setError(message: string) {
      update(state => ({
        ...state,
        status: 'error',
        errorMessage: message,
      }));
    },

    /**
     * Update pending count
     */
    updatePendingCount(count: number) {
      update(state => ({
        ...state,
        pendingCount: count,
        status: count > 0 ? 'pending' : 'synced',
      }));
    },
  };
}

export const syncStatus = createSyncStore();

/**
 * Derived store for sync icon
 */
export const syncIcon = derived(syncStatus, $syncStatus => {
  switch ($syncStatus.status) {
    case 'synced':
      return '✓';
    case 'syncing':
      return '↻';
    case 'offline':
      return '📴';
    case 'pending':
      return '⏳';
    case 'error':
      return '⚠';
    default:
      return '?';
  }
});

/**
 * Derived store for sync label
 */
export const syncLabel = derived(syncStatus, $syncStatus => {
  switch ($syncStatus.status) {
    case 'synced':
      return 'All changes saved';
    case 'syncing':
      return 'Syncing...';
    case 'offline':
      return 'Offline - will sync when online';
    case 'pending':
      return `${$syncStatus.pendingCount} change${$syncStatus.pendingCount !== 1 ? 's' : ''} pending`;
    case 'error':
      return $syncStatus.errorMessage || 'Sync error';
    default:
      return 'Unknown status';
  }
});

/**
 * Derived store for sync color
 */
export const syncColor = derived(syncStatus, $syncStatus => {
  switch ($syncStatus.status) {
    case 'synced':
      return 'green';
    case 'syncing':
      return 'blue';
    case 'offline':
      return 'orange';
    case 'pending':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
});
