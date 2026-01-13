// src/lib/sync/syncManager.ts
import { getDB } from '$lib/db/indexedDB';
import { syncStatus } from '$lib/stores/sync';
import type { SyncQueueItem } from '$lib/db/types';
import { loadGoogleMaps } from '$lib/utils/autocomplete';

class SyncManager {
	private initialized = false;
	private syncInterval: ReturnType<typeof setInterval> | null = null;
	private isSyncing = false;
	private apiKey: string = '';

	// [!code change] Changed from single Updater to array of Listeners
	private listeners: ((item: any) => void)[] = [];

	// [!code change] New method to subscribe multiple stores
	subscribe(fn: (item: any) => void) {
		this.listeners.push(fn);
	}

	// [!code change] Deprecated method kept for backward compatibility
	setStoreUpdater(fn: (item: any) => void) {
		this.subscribe(fn);
	}

	// [!code change] Helper to notify all listeners
	private notifyListeners(item: any) {
		if (this.listeners.length > 0) {
			this.listeners.forEach((fn) => fn(item));
		}
	}

	async initialize(apiKey?: string) {
		if (this.initialized) return;

		console.log('🔧 Initializing sync manager...');
		if (apiKey) this.apiKey = apiKey;

		syncStatus.setOnline(navigator.onLine);

		if (typeof window !== 'undefined') {
			window.addEventListener('online', () => this.handleOnline());
			window.addEventListener('offline', () => this.handleOffline());

			document.addEventListener('visibilitychange', () => {
				if (!document.hidden && navigator.onLine) {
					this.syncNow();
				}
			});
		}

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

		if (navigator.onLine && !this.isSyncing) {
			await this.syncNow();
		}
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
			let failCount = 0;

			for (const item of queue) {
				try {
					// Enrich data only if it's a trip
					if (
						(item.action === 'create' || item.action === 'update') &&
						item.data &&
						(!item.data.store || item.data.store === 'trips')
					) {
						await this.enrichTripData(item.data);
					}

					await this.processSyncItem(item);
					await this.removeFromQueue(item.id!);
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

	private async enrichTripData(trip: any) {
		if (trip.totalMiles === 0 && trip.startAddress) {
			console.log(`🧮 Calculating offline route for trip ${trip.id}...`);

			try {
				await loadGoogleMaps(this.apiKey);

				const directionsService = new google.maps.DirectionsService();
				const waypoints = (trip.stops || []).map((s: any) => ({
					location: s.address,
					stopover: true
				}));
				const destination = trip.endAddress || trip.startAddress;

				const result = await directionsService.route({
					origin: trip.startAddress,
					destination: destination,
					waypoints: waypoints,
					travelMode: google.maps.TravelMode.DRIVING
				});

				if (result && result.routes[0]) {
					const leg = result.routes[0].legs.reduce(
						(acc: any, curr: any) => ({
							dist: acc.dist + curr.distance.value,
							dur: acc.dur + curr.duration.value
						}),
						{ dist: 0, dur: 0 }
					);

					trip.totalMiles = Math.round((leg.dist / 1609.34) * 10) / 10;
					trip.estimatedTime = Math.round(leg.dur / 60);

					if (trip.mpg && trip.gasPrice) {
						const gallons = trip.totalMiles / trip.mpg;
						trip.fuelCost = Math.round(gallons * trip.gasPrice * 100) / 100;
					}

					const earnings = (trip.stops || []).reduce(
						(s: number, stop: any) => s + (Number(stop.earnings) || 0),
						0
					);
					const costs =
						(trip.fuelCost || 0) + (trip.maintenanceCost || 0) + (trip.suppliesCost || 0);
					trip.netProfit = earnings - costs;

					const db = await getDB();
					const tx = db.transaction('trips', 'readwrite');
					await tx.objectStore('trips').put(trip);
					await tx.done;

					// [!code change] Notify all listeners
					console.log('⚡ Updating UI with enriched data:', trip.id);
					this.notifyListeners(trip);
				}
			} catch (e) {
				console.warn('⚠️ Could not calculate route for offline trip:', e);
			}
		}
	}

	private async processSyncItem(item: SyncQueueItem) {
		const { action, tripId, data } = item;

		const storeName = ((data as any)?.store as string) || 'trips';
		const baseUrl = storeName === 'expenses' ? '/api/expenses' : '/api/trips';
		const url =
			action === 'create'
				? baseUrl
				: action.includes('delete')
					? `${baseUrl}/${tripId}`
					: `${baseUrl}/${tripId}`;

		let targetStore: 'trips' | 'expenses' | 'trash' | null =
			storeName === 'expenses' ? 'expenses' : 'trips';

		if (action === 'delete') targetStore = 'trash';
		if (action === 'permanentDelete') targetStore = null;

		if (action === 'create') await this.apiCall(url, 'POST', data, targetStore, tripId);
		else if (action === 'update') await this.apiCall(url, 'PUT', data, targetStore, tripId);
		else if (action === 'delete') await this.apiCall(url, 'DELETE', null, 'trash', tripId);
		else if (action === 'restore')
			await this.apiCall(`/api/trash/${tripId}`, 'POST', null, 'trips', tripId);
		else if (action === 'permanentDelete')
			await this.apiCall(`/api/trash/${tripId}`, 'DELETE', null, null, tripId);
	}

	private async apiCall(
		url: string,
		method: string,
		body: any,
		updateStore: 'trips' | 'expenses' | 'trash' | null,
		id: string
	) {
		const res = await fetch(url, {
			method,
			keepalive: true,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined
		});

		if (!res.ok) {
			if (res.status >= 400 && res.status < 500) {
				const errText = await res.text().catch(() => '');
				throw new Error(
					`ABORT_RETRY: Server rejected request (${res.status}): ${errText.substring(0, 100)}`
				);
			}
			throw new Error(`${method} failed with status ${res.status}`);
		}

		if (updateStore) await this.markAsSynced(updateStore, id);
	}

	private async markAsSynced(store: 'trips' | 'expenses' | 'trash', tripId: string) {
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

		const isFatal = error.message?.includes('ABORT_RETRY');

		if (isFatal) {
			console.error(
				`🛑 Sync failed permanently for item ${item.id} (Trip ${item.tripId}). Removing from queue.`
			);
			await store.delete(item.id!);
			syncStatus.setError(`Sync rejected: ${error.message.replace('ABORT_RETRY: ', '')}`);
		} else {
			item.retries = (item.retries || 0) + 1;
			item.lastError = error.message || String(error);

			if (item.retries > 5) await store.delete(item.id!);
			else await store.put(item);
		}

		await tx.done;
	}

	private async removeFromQueue(id: number) {
		const db = await getDB();
		await db.delete('syncQueue', id);
	}

	async forceSyncNow() {
		await this.syncNow();
	}

	destroy() {
		this.stopAutoSync();
		this.initialized = false;
	}
}

export const syncManager = new SyncManager();