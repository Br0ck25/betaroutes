// src/lib/sync/syncManager.ts
import { getDB } from '$lib/db/indexedDB';
import { syncStatus } from '$lib/stores/sync';
import type { SyncQueueItem, TripRecord } from '$lib/db/types';
import { loadGoogleMaps } from '$lib/utils/autocomplete';

interface StoreHandler {
	updateLocal: (data: any) => void;
	syncDown: () => Promise<void>;
}

class SyncManager {
	private initialized = false;
	private syncInterval: ReturnType<typeof setInterval> | null = null;
	private isSyncing = false;
	private apiKey: string = '';
	private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingSyncRequest = false;

	private registeredStores = new Map<string, StoreHandler>();
	private storeUpdater?: (trip: TripRecord) => void;

	registerStore(name: string, handler: StoreHandler) {
		this.registeredStores.set(name, handler);
	}

	setStoreUpdater(updater: (trip: TripRecord) => void) {
		this.storeUpdater = updater;
	}

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
			// Initial pull
			await this.syncDownAll();
			this.startAutoSync();
		}

		await this.updatePendingCount();
		this.initialized = true;
		console.log('✅ Sync manager initialized');
	}

	private async syncDownAll() {
		console.log('⬇️ Downloading latest data (Refresh)...');
		await Promise.all(
			Array.from(this.registeredStores.values()).map((store) =>
				store.syncDown().catch((e) => console.error('Store sync down failed:', e))
			)
		);
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
			// Debounce sync to avoid excessive calls
			this.debouncedSync();
		}
	}

	private debouncedSync() {
		if (this.syncDebounceTimer) {
			clearTimeout(this.syncDebounceTimer);
		}
		this.pendingSyncRequest = true;
		this.syncDebounceTimer = setTimeout(() => {
			this.syncDebounceTimer = null;
			if (this.pendingSyncRequest) {
				this.pendingSyncRequest = false;
				this.syncNow();
			}
		}, 300); // 300ms debounce
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

			if (queue.length > 0) {
				console.log(`🔄 Syncing ${queue.length} item(s)...`);
				let failCount = 0;

				for (const item of queue) {
					try {
						// Enrich only if it's a trip creation/update and not deleted
						// Also skip if explicitly flagged (e.g., when updating trip after mileage deletion)
						if (
							(item.action === 'create' || item.action === 'update') &&
							item.data &&
							(!item.data.store || item.data.store === 'trips') &&
							!item.data.skipEnrichment
						) {
							// [!code fix] Safe enrichment block
							try {
								await this.enrichTripData(item.data);
							} catch (enrichErr) {
								console.warn('⚠️ Failed to enrich trip data (proceeding anyway):', enrichErr);
							}
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
				if (failCount > 0) syncStatus.setError(`${failCount} item(s) failed`);
			}

			syncStatus.setSynced();
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
				// [!code fix] Explicitly catch Map loading errors
				try {
					await loadGoogleMaps(this.apiKey);
				} catch (loaderErr) {
					console.warn('⚠️ Google Maps failed to load (blocked/offline). Skipping.', loaderErr);
					return;
				}

				// [!code fix] Ensure service is available before constructing
				if (
					typeof google === 'undefined' ||
					!google.maps ||
					typeof google.maps.DirectionsService !== 'function'
				) {
					console.warn('⚠️ Google Maps DirectionsService not available.');
					return;
				}

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

					const tripsStore = this.registeredStores.get('trips');
					if (this.storeUpdater) {
						this.storeUpdater(trip as TripRecord);
					} else if (tripsStore) {
						tripsStore.updateLocal(trip);
					}
				}
			} catch (e) {
				console.warn('⚠️ Could not calculate route for offline trip:', e);
			}
		}
	}

	private async processSyncItem(item: SyncQueueItem) {
		const { action, tripId, data } = item;

		const storeName = ((data as any)?.store as string) || 'trips';
		const baseUrl =
			storeName === 'expenses'
				? '/api/expenses'
				: storeName === 'mileage'
					? '/api/mileage'
					: '/api/trips';

		const url =
			action === 'create'
				? baseUrl
				: action.includes('delete')
					? `${baseUrl}/${tripId}`
					: `${baseUrl}/${tripId}`;

		let targetStore: 'trips' | 'expenses' | 'mileage' | 'trash' | null =
			storeName === 'expenses' ? 'expenses' : storeName === 'mileage' ? 'mileage' : 'trips';

		if (action === 'delete') targetStore = 'trash';
		if (action === 'permanentDelete') targetStore = null;

		if (action === 'create') await this.apiCall(url, 'POST', data, targetStore, tripId);
		else if (action === 'update') await this.apiCall(url, 'PUT', data, targetStore, tripId);
		else if (action === 'delete') await this.apiCall(url, 'DELETE', null, 'trash', tripId);
		else if (action === 'restore')
			await this.apiCall(`/api/trash/${tripId}`, 'POST', null, 'trips', tripId);
		else if (action === 'permanentDelete') {
			// Include record type as query param so server knows which service to delete from
			const recordType = (data as any)?.recordType;
			const deleteUrl = recordType
				? `/api/trash/${tripId}?type=${encodeURIComponent(recordType)}`
				: `/api/trash/${tripId}`;
			await this.apiCall(deleteUrl, 'DELETE', null, null, tripId);
		}
	}

	private async apiCall(
		url: string,
		method: string,
		body: any,
		updateStore: 'trips' | 'expenses' | 'mileage' | 'trash' | null,
		id: string
	) {
		const res = await fetch(url, {
			method,
			keepalive: true,
			credentials: 'include',
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

	private async markAsSynced(store: 'trips' | 'expenses' | 'mileage' | 'trash', tripId: string) {
		const db = await getDB();
		const tx = db.transaction(store, 'readwrite');
		const objectStore = tx.objectStore(store);
		// [!code fix] Handle prefixed IDs (like mileage:abc) by checking both if needed, or just standard get
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
