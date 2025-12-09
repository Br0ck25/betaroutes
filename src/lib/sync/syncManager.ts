// src/lib/sync/syncManager.ts
import { getDB } from '$lib/db/indexedDB';
import { syncStatus } from '$lib/stores/sync';
import type { SyncQueueItem } from '$lib/db/types';
import { get } from 'svelte/store';

/**
 * Sync Manager
 * * Handles syncing between IndexedDB (local) and Cloudflare KV (cloud)
 * * Features:
 * - Auto-syncs when online
 * - Queues changes when offline
 * - Retries failed syncs
 * - Reports sync status
 */
class SyncManager {
  private initialized = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;

  /**
   * Initialize the sync manager
   */
  async initialize() {
    if (this.initialized) {
      console.log('⚠️ Sync manager already initialized');
      return;
    }

    console.log('🔧 Initializing sync manager...');

    // Set initial online status
    syncStatus.setOnline(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Listen for visibility change (tab becomes visible)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) {
        this.syncNow();
      }
    });

    // Initial sync if online
    if (navigator.onLine) {
      await this.syncNow();
      this.startAutoSync();
    }

    // Update pending count
    await this.updatePendingCount();

    this.initialized = true;
    console.log('✅ Sync manager initialized');
  }

  /**
   * Handle going online
   */
  private async handleOnline() {
    console.log('🌐 Back online!');
    syncStatus.setOnline(true);
    
    // 1. Sync immediately (Push changes)
    await this.syncNow();

    // 2. Pull latest data from cloud (Pull changes)
    try {
        // Dynamic import to avoid circular dependency
        const { trips } = await import('$lib/stores/trips');
        const { auth } = await import('$lib/stores/auth');
        
        const currentUser = get(auth).user;
        if (currentUser) {
            console.log('📥 Pulling latest data from cloud...');
            const syncId = currentUser.name || currentUser.token;
            await trips.syncFromCloud(syncId);
        }
    } catch (err) {
        console.error('Failed to pull data on reconnect:', err);
    }
    
    // Start auto-sync
    this.startAutoSync();
  }

  /**
   * Handle going offline
   */
  private handleOffline() {
    console.log('📴 Offline mode');
    syncStatus.setOnline(false);
    
    // Stop auto-sync
    this.stopAutoSync();
  }

  /**
   * Start auto-sync interval (every 30 seconds)
   */
  private startAutoSync() {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.syncNow();
      }
    }, 30000); // 30 seconds

    console.log('⏱️ Auto-sync started (every 30s)');
  }

  /**
   * Stop auto-sync interval
   */
  private stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('⏸️ Auto-sync stopped');
    }
  }

  /**
   * Add an action to the sync queue
   */
  async addToQueue(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retries'>) {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    
    await tx.objectStore('syncQueue').add({
      ...item,
      timestamp: Date.now(),
      retries: 0,
    });
    
    await tx.done;

    // Update pending count
    await this.updatePendingCount();

    console.log(`📋 Added to sync queue: ${item.action} ${item.tripId}`);

    // Try to sync immediately if online
    if (navigator.onLine && !this.isSyncing) {
      this.syncNow();
    }
  }

  /**
   * Update pending count in sync status
   */
  private async updatePendingCount() {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readonly');
    const count = await tx.objectStore('syncQueue').count();
    
    syncStatus.updatePendingCount(count);
  }

  /**
   * Sync now - process all items in queue
   */
  async syncNow() {
    if (!navigator.onLine) {
      console.log('📴 Cannot sync while offline');
      return;
    }

    if (this.isSyncing) {
      console.log('⏳ Already syncing, skipping...');
      return;
    }

    this.isSyncing = true;
    syncStatus.setSyncing();

    try {
      const db = await getDB();
      const tx = db.transaction('syncQueue', 'readonly');
      const queue = await tx.objectStore('syncQueue').getAll();

      if (queue.length === 0) {
        // Even if nothing to push, we might set synced
        // console.log('✅ Nothing to sync');
        syncStatus.setSynced();
        this.isSyncing = false;
        return;
      }

      console.log(`🔄 Syncing ${queue.length} item(s)...`);

      let successCount = 0;
      let failCount = 0;

      // Process each item in the queue
      for (const item of queue) {
        try {
          await this.processSyncItem(item);
          await this.removeFromQueue(item.id!);
          successCount++;
          console.log(`✅ Synced: ${item.action} ${item.tripId}`);
        } catch (err) {
          failCount++;
          console.error(`❌ Failed to sync: ${item.action} ${item.tripId}`, err);
          await this.handleSyncError(item, err);
        }
      }

      console.log(`✅ Sync complete: ${successCount} success, ${failCount} failed`);

      // Update status
      await this.updatePendingCount();
      
      if (failCount === 0) {
        syncStatus.setSynced();
      } else {
        syncStatus.setError(`${failCount} item(s) failed to sync`);
      }

    } catch (err) {
      console.error('❌ Sync error:', err);
      syncStatus.setError('Sync failed');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process a single sync item
   */
  private async processSyncItem(item: SyncQueueItem) {
    const { action, tripId, data } = item;

    switch (action) {
      case 'create':
        await this.syncCreate(tripId, data);
        break;

      case 'update':
        await this.syncUpdate(tripId, data);
        break;

      case 'delete':
        await this.syncDelete(tripId);
        break;

      case 'restore':
        await this.syncRestore(tripId);
        break;

      case 'permanentDelete':
        await this.syncPermanentDelete(tripId);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * Sync: Create trip
   */
  private async syncCreate(tripId: string, data: any) {
    const response = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Create failed: ${response.statusText}`);
    }

    // Update local record to mark as synced
    await this.markAsSynced('trips', tripId);
  }

  /**
   * Sync: Update trip
   */
  private async syncUpdate(tripId: string, data: any) {
    const response = await fetch(`/api/trips/${tripId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Update failed: ${response.statusText}`);
    }

    // Update local record to mark as synced
    await this.markAsSynced('trips', tripId);
  }

  /**
   * Sync: Delete trip (soft delete - move to trash)
   */
  private async syncDelete(tripId: string) {
    const response = await fetch(`/api/trips/${tripId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.statusText}`);
    }

    // Update local trash record to mark as synced
    await this.markAsSynced('trash', tripId);
  }

  /**
   * Sync: Restore trip from trash
   */
  private async syncRestore(tripId: string) {
    const response = await fetch(`/api/trash/${tripId}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Restore failed: ${response.statusText}`);
    }

    // Update local record to mark as synced
    await this.markAsSynced('trips', tripId);
  }

  /**
   * Sync: Permanently delete from trash
   */
  private async syncPermanentDelete(tripId: string) {
    const response = await fetch(`/api/trash/${tripId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Permanent delete failed: ${response.statusText}`);
    }
  }

  /**
   * Mark a record as synced in IndexedDB
   */
  private async markAsSynced(store: 'trips' | 'trash', tripId: string) {
    const db = await getDB();
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    
    const record = await objectStore.get(tripId);
    
    if (record) {
      record.syncStatus = 'synced';
      record.lastSyncedAt = new Date().toISOString();
      await objectStore.put(record);
    }
    
    await tx.done;
  }

  /**
   * Handle sync error - increment retry count or remove
   */
  private async handleSyncError(item: SyncQueueItem, error: any) {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');

    // Increment retry count
    item.retries = (item.retries || 0) + 1;
    item.lastError = error.message || String(error);

    // Give up after 5 retries
    if (item.retries > 5) {
      console.warn(`⚠️ Giving up on ${item.action} ${item.tripId} after ${item.retries} retries`);
      await store.delete(item.id!);
    } else {
      console.log(`🔄 Retry ${item.retries}/5 for ${item.action} ${item.tripId}`);
      await store.put(item);
    }

    await tx.done;
  }

  /**
   * Remove item from sync queue
   */
  private async removeFromQueue(id: number) {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    await tx.objectStore('syncQueue').delete(id);
    await tx.done;
  }

  /**
   * Force sync now (useful for manual sync button)
   */
  async forceSyncNow() {
    console.log('🔄 Force sync triggered');
    await this.syncNow();
  }

  /**
   * Get sync queue for debugging
   */
  async getSyncQueue() {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readonly');
    const queue = await tx.objectStore('syncQueue').getAll();
    return queue;
  }

  /**
   * Clear sync queue (for debugging only)
   */
  async clearSyncQueue() {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    await tx.objectStore('syncQueue').clear();
    await tx.done;
    await this.updatePendingCount();
    console.log('🗑️ Sync queue cleared');
  }

  /**
   * Destroy sync manager (cleanup)
   */
  destroy() {
    this.stopAutoSync();
    window.removeEventListener('online', () => this.handleOnline());
    window.removeEventListener('offline', () => this.handleOffline());
    this.initialized = false;
    console.log('🛑 Sync manager destroyed');
  }
}

// Export singleton instance
export const syncManager = new SyncManager();