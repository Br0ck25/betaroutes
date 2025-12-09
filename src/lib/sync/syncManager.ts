// src/lib/sync/syncManager.ts
import { getDB } from '$lib/db/indexedDB';
import { syncStatus } from '$lib/stores/sync';
import type { SyncQueueItem } from '$lib/db/types';

/**
 * Sync Manager
 * * Handles syncing between IndexedDB (local) and Cloudflare KV (cloud)
 * Features: Auto-sync, Retry logic, and **Offline Trip Calculation**.
 */
class SyncManager {
  private initialized = false;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private apiKey: string = '';

  /**
   * Initialize with API Key for offline calculations
   */
  async initialize(apiKey?: string) {
    if (this.initialized) return;

    console.log('🔧 Initializing sync manager...');
    if (apiKey) this.apiKey = apiKey;

    syncStatus.setOnline(navigator.onLine);

    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine) {
        this.syncNow();
      }
    });

    if (navigator.onLine) {
      await this.syncNow();
      this.startAutoSync();
    }

    await this.updatePendingCount();
    this.initialized = true;
    console.log('✅ Sync manager initialized');
  }

  private async handleOnline() {
    console.log('🌐 Back online!');
    syncStatus.setOnline(true);
    await this.syncNow();
    this.startAutoSync();
  }

  private handleOffline() {
    console.log('📴 Offline mode');
    syncStatus.setOnline(false);
    this.stopAutoSync();
  }

  private startAutoSync() {
    if (this.syncInterval) return;
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) this.syncNow();
    }, 30000);
  }

  private stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async addToQueue(item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retries'>) {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    await tx.objectStore('syncQueue').add({ ...item, timestamp: Date.now(), retries: 0 });
    await tx.done;
    await this.updatePendingCount();
    console.log(`📋 Added to sync queue: ${item.action} ${item.tripId}`);
    if (navigator.onLine && !this.isSyncing) this.syncNow();
  }

  private async updatePendingCount() {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readonly');
    const count = await tx.objectStore('syncQueue').count();
    syncStatus.updatePendingCount(count);
  }

  async syncNow() {
    if (!navigator.onLine || this.isSyncing) return;

    this.isSyncing = true;
    syncStatus.setSyncing();

    try {
      const db = await getDB();
      const queue = await db.getAll('syncQueue');

      if (queue.length === 0) {
        syncStatus.setSynced();
        this.isSyncing = false;
        return;
      }

      console.log(`🔄 Syncing ${queue.length} item(s)...`);
      let successCount = 0;
      let failCount = 0;

      for (const item of queue) {
        try {
          // --- ENRICHMENT STEP ---
          // If this is a trip creation/update and miles are missing, calculate them now
          if ((item.action === 'create' || item.action === 'update') && item.data) {
             await this.enrichTripData(item.data);
          }

          await this.processSyncItem(item);
          await this.removeFromQueue(item.id!);
          successCount++;
        } catch (err) {
          failCount++;
          console.error(`❌ Failed to sync: ${item.action} ${item.tripId}`, err);
          await this.handleSyncError(item, err);
        }
      }

      await this.updatePendingCount();
      if (failCount === 0) syncStatus.setSynced();
      else syncStatus.setError(`${failCount} item(s) failed`);

    } catch (err) {
      console.error('❌ Sync error:', err);
      syncStatus.setError('Sync failed');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Calculates miles, time, and costs if they are missing (0)
   */
  private async enrichTripData(trip: any) {
    // Only calculate if miles are 0 AND we have addresses
    if (trip.totalMiles === 0 && trip.startAddress) {
        console.log(`🧮 Calculating offline route for trip ${trip.id}...`);
        
        try {
            await this.ensureGoogleMapsLoaded();
            
            const directionsService = new google.maps.DirectionsService();
            const waypoints = (trip.stops || []).map((s: any) => ({ location: s.address, stopover: true }));
            const destination = trip.endAddress || trip.startAddress;

            const result = await directionsService.route({
                origin: trip.startAddress,
                destination: destination,
                waypoints: waypoints,
                travelMode: google.maps.TravelMode.DRIVING
            });

            if (result && result.routes[0]) {
                const leg = result.routes[0].legs.reduce((acc: any, curr: any) => ({
                    dist: acc.dist + curr.distance.value,
                    dur: acc.dur + curr.duration.value
                }), { dist: 0, dur: 0 });

                // Update Trip Data
                trip.totalMiles = Math.round((leg.dist / 1609.34) * 10) / 10;
                trip.estimatedTime = Math.round(leg.dur / 60);
                
                // Recalculate Financials
                if (trip.mpg && trip.gasPrice) {
                    const gallons = trip.totalMiles / trip.mpg;
                    trip.fuelCost = Math.round(gallons * trip.gasPrice * 100) / 100;
                }
                
                const earnings = (trip.stops || []).reduce((s: number, stop: any) => s + (Number(stop.earnings) || 0), 0);
                const costs = (trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
                trip.netProfit = earnings - costs;

                // Update Local DB immediately so UI reflects calculations
                const db = await getDB();
                const tx = db.transaction('trips', 'readwrite');
                await tx.objectStore('trips').put(trip);
                await tx.done;
                
                console.log(`✅ Offline trip calculated: ${trip.totalMiles} mi, $${trip.fuelCost} fuel`);
            }
        } catch (e) {
            console.warn('⚠️ Could not calculate route for offline trip:', e);
            // We proceed syncing anyway; better to save raw data than nothing
        }
    }
  }

  private async ensureGoogleMapsLoaded() {
      if (window.google && window.google.maps) return;
      if (!this.apiKey) throw new Error("No API Key");

      return new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places`;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject("Failed to load Maps");
          document.head.appendChild(script);
      });
  }

  private async processSyncItem(item: SyncQueueItem) {
    const { action, tripId, data } = item;
    const method = action === 'create' ? 'POST' : action === 'update' || action === 'restore' ? 'PUT' : 'DELETE';
    const url = action === 'create' ? '/api/trips' : 
                action.includes('delete') ? `/api/trips/${tripId}` : 
                `/api/trips/${tripId}`; // Simplify for brevity

    // Custom handling per action type to match server API
    if (action === 'create') await this.apiCall('/api/trips', 'POST', data, 'trips', tripId);
    else if (action === 'update') await this.apiCall(`/api/trips/${tripId}`, 'PUT', data, 'trips', tripId);
    else if (action === 'delete') await this.apiCall(`/api/trips/${tripId}`, 'DELETE', null, 'trash', tripId);
    else if (action === 'restore') await this.apiCall(`/api/trash/${tripId}`, 'POST', null, 'trips', tripId);
    else if (action === 'permanentDelete') await this.apiCall(`/api/trash/${tripId}`, 'DELETE', null, null, tripId);
  }

  private async apiCall(url: string, method: string, body: any, updateStore: 'trips' | 'trash' | null, id: string) {
      const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) throw new Error(`${method} failed`);
      if (updateStore) await this.markAsSynced(updateStore, id);
  }

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

  private async handleSyncError(item: SyncQueueItem, error: any) {
    const db = await getDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    item.retries = (item.retries || 0) + 1;
    item.lastError = error.message || String(error);
    if (item.retries > 5) await store.delete(item.id!);
    else await store.put(item);
    await tx.done;
  }

  private async removeFromQueue(id: number) {
    const db = await getDB();
    await db.delete('syncQueue', id);
  }

  async forceSyncNow() { await this.syncNow(); }
  
  destroy() {
    this.stopAutoSync();
    this.initialized = false;
  }
}

export const syncManager = new SyncManager();