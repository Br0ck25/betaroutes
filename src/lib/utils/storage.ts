// src/lib/utils/storage.ts
import type { Trip, Settings } from '$lib/types';

const STORAGE_KEYS = {
	// TRIPS: 'trips', // REMOVED: Trips are now in IndexedDB
	CACHED_LOGS: 'cachedLogs',
	DRAFT_TRIP: 'draftTrip',
	TOKEN: 'token',
	USERNAME: 'username',
	SETTINGS: 'settings',
	RECENT_DESTINATIONS: 'recentDestinations',
	MAINTENANCE_CATEGORIES: 'maintenanceCategories',
	SUPPLY_CATEGORIES: 'supplyCategories',
	LAST_SYNC: 'last_sync_time' // [!code ++] New Key
} as const;

class LocalStorage {
	private isClient = typeof window !== 'undefined';

	// --- Generic Helpers ---
	private get<T>(key: string): T | null {
		if (!this.isClient) return null;
		try {
			const item = localStorage.getItem(key);
			return item ? JSON.parse(item) : null;
		} catch (error) {
			console.error(`Error reading ${key} from localStorage:`, error);
			return null;
		}
	}

	private set<T>(key: string, value: T): void {
		if (!this.isClient) return;
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (error) {
			console.error(`Error writing ${key} to localStorage:`, error);
		}
	}

	private remove(key: string): void {
		if (!this.isClient) return;
		localStorage.removeItem(key);
	}

	// --- [!code ++] NEW: Delta Sync Timestamp ---
	getLastSync(): string | null {
		return this.isClient ? localStorage.getItem(STORAGE_KEYS.LAST_SYNC) : null;
	}

	setLastSync(isoString: string): void {
		if (this.isClient) {
			localStorage.setItem(STORAGE_KEYS.LAST_SYNC, isoString);
		}
	}

	// --- Draft Trip (Keep for Auto-save) ---
	getDraftTrip(): Partial<Trip> | null {
		return this.get<Partial<Trip>>(STORAGE_KEYS.DRAFT_TRIP);
	}

	saveDraftTrip(draft: Partial<Trip>): void {
		this.set(STORAGE_KEYS.DRAFT_TRIP, draft);
	}

	clearDraftTrip(): void {
		this.remove(STORAGE_KEYS.DRAFT_TRIP);
	}

	// --- Auth (Username only - sessions are in httpOnly cookies) ---
	// [SECURITY FIX #52] Removed getToken/setToken/clearToken methods
	// Session tokens should NEVER be in localStorage - they're in httpOnly cookies

	getUsername(): string | null {
		return this.isClient ? localStorage.getItem(STORAGE_KEYS.USERNAME) : null;
	}

	setUsername(username: string): void {
		if (this.isClient) localStorage.setItem(STORAGE_KEYS.USERNAME, username);
	}

	clearUsername(): void {
		this.remove(STORAGE_KEYS.USERNAME);
	}

	// --- Settings ---
	getSettings(): Partial<Settings> {
		return this.get<Settings>(STORAGE_KEYS.SETTINGS) || {};
	}

	saveSettings(settings: Partial<Settings>): void {
		const current = this.getSettings();
		this.set(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
	}

	getSetting<K extends keyof Settings>(key: K): Settings[K] | undefined {
		const settings = this.getSettings();
		return settings[key];
	}

	setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
		const settings = this.getSettings();
		settings[key] = value;
		this.saveSettings(settings);
	}

	// --- Recent Destinations ---
	getRecentDestinations(): string[] {
		return this.get<string[]>(STORAGE_KEYS.RECENT_DESTINATIONS) || [];
	}

	addRecentDestination(address: string): void {
		const recent = this.getRecentDestinations();
		const filtered = recent.filter((a) => a !== address);
		filtered.unshift(address);
		const trimmed = filtered.slice(0, 10);
		this.set(STORAGE_KEYS.RECENT_DESTINATIONS, trimmed);
	}

	// --- Maintenance Categories ---
	getMaintenanceCategories(): string[] {
		return (
			this.get<string[]>(STORAGE_KEYS.MAINTENANCE_CATEGORIES) || [
				'Oil Change',
				'Tire Rotation',
				'Brake Service',
				'Battery'
			]
		);
	}

	addMaintenanceCategory(category: string): void {
		const categories = this.getMaintenanceCategories();
		if (!categories.includes(category)) {
			categories.push(category);
			this.set(STORAGE_KEYS.MAINTENANCE_CATEGORIES, categories);
		}
	}

	deleteMaintenanceCategory(category: string): void {
		const categories = this.getMaintenanceCategories().filter((c) => c !== category);
		this.set(STORAGE_KEYS.MAINTENANCE_CATEGORIES, categories);
	}

	// --- Supply Categories ---
	getSupplyCategories(): string[] {
		return (
			this.get<string[]>(STORAGE_KEYS.SUPPLY_CATEGORIES) || [
				'Gas',
				'Tools',
				'Materials',
				'Equipment'
			]
		);
	}

	addSupplyCategory(category: string): void {
		const categories = this.getSupplyCategories();
		if (!categories.includes(category)) {
			categories.push(category);
			this.set(STORAGE_KEYS.SUPPLY_CATEGORIES, categories);
		}
	}

	deleteSupplyCategory(category: string): void {
		const categories = this.getSupplyCategories().filter((c) => c !== category);
		this.set(STORAGE_KEYS.SUPPLY_CATEGORIES, categories);
	}

	// --- Clear Data ---
	clearAll(): void {
		if (!this.isClient) return;
		localStorage.clear();
	}

	clearAllExceptAuth(): void {
		// [SECURITY FIX #52] Tokens no longer in localStorage
		const username = this.getUsername();

		this.clearAll();

		if (username) this.setUsername(username);
	}
}

export const storage = new LocalStorage();
