// src/lib/utils/storage.ts

import type { Trip, Settings } from '$lib/types';

const STORAGE_KEYS = {
  TRIPS: 'trips',
  CACHED_LOGS: 'cachedLogs',
  DRAFT_TRIP: 'draftTrip',
  TOKEN: 'token',
  USERNAME: 'username',
  SETTINGS: 'settings',
  RECENT_DESTINATIONS: 'recentDestinations',
  MAINTENANCE_CATEGORIES: 'maintenanceCategories',
  SUPPLY_CATEGORIES: 'supplyCategories',
} as const;

class LocalStorage {
  private isClient = typeof window !== 'undefined';

  // Generic get/set
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

  // Trips
  getTrips(): Trip[] {
    return this.get<Trip[]>(STORAGE_KEYS.TRIPS) || [];
  }

  saveTrips(trips: Trip[]): void {
    this.set(STORAGE_KEYS.TRIPS, trips);
  }

  addTrip(trip: Trip): void {
    const trips = this.getTrips();
    trips.unshift(trip); // Add to beginning
    this.saveTrips(trips);
  }

  updateTrip(id: string, updatedTrip: Trip): void {
    const trips = this.getTrips();
    const index = trips.findIndex(t => t.id === id);
    if (index !== -1) {
      trips[index] = updatedTrip;
      this.saveTrips(trips);
    }
  }

  deleteTrip(id: string): void {
    const trips = this.getTrips().filter(t => t.id !== id);
    this.saveTrips(trips);
  }

  // Cached cloud logs
  getCachedLogs(): Trip[] {
    return this.get<Trip[]>(STORAGE_KEYS.CACHED_LOGS) || [];
  }

  setCachedLogs(logs: Trip[]): void {
    this.set(STORAGE_KEYS.CACHED_LOGS, logs);
  }

  // Draft trip (auto-save)
  getDraftTrip(): Partial<Trip> | null {
    return this.get<Partial<Trip>>(STORAGE_KEYS.DRAFT_TRIP);
  }

  saveDraftTrip(draft: Partial<Trip>): void {
    this.set(STORAGE_KEYS.DRAFT_TRIP, draft);
  }

  clearDraftTrip(): void {
    this.remove(STORAGE_KEYS.DRAFT_TRIP);
  }

  // Auth
  getToken(): string | null {
    return this.isClient ? localStorage.getItem(STORAGE_KEYS.TOKEN) : null;
  }

  setToken(token: string): void {
    if (this.isClient) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    }
  }

  clearToken(): void {
    this.remove(STORAGE_KEYS.TOKEN);
  }

  getUsername(): string | null {
    return this.isClient ? localStorage.getItem(STORAGE_KEYS.USERNAME) : null;
  }

  setUsername(username: string): void {
    if (this.isClient) {
      localStorage.setItem(STORAGE_KEYS.USERNAME, username);
    }
  }

  clearUsername(): void {
    this.remove(STORAGE_KEYS.USERNAME);
  }

  // Settings
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

  // Recent destinations
  getRecentDestinations(): string[] {
    return this.get<string[]>(STORAGE_KEYS.RECENT_DESTINATIONS) || [];
  }

  addRecentDestination(address: string): void {
    const recent = this.getRecentDestinations();
    
    // Remove if already exists
    const filtered = recent.filter(a => a !== address);
    
    // Add to beginning
    filtered.unshift(address);
    
    // Keep only last 10
    const trimmed = filtered.slice(0, 10);
    
    this.set(STORAGE_KEYS.RECENT_DESTINATIONS, trimmed);
  }

  // Maintenance categories
  getMaintenanceCategories(): string[] {
    return this.get<string[]>(STORAGE_KEYS.MAINTENANCE_CATEGORIES) || [
      'Oil Change',
      'Tire Rotation',
      'Brake Service',
      'Battery',
    ];
  }

  addMaintenanceCategory(category: string): void {
    const categories = this.getMaintenanceCategories();
    if (!categories.includes(category)) {
      categories.push(category);
      this.set(STORAGE_KEYS.MAINTENANCE_CATEGORIES, categories);
    }
  }

  deleteMaintenanceCategory(category: string): void {
    const categories = this.getMaintenanceCategories().filter(c => c !== category);
    this.set(STORAGE_KEYS.MAINTENANCE_CATEGORIES, categories);
  }

  // Supply categories
  getSupplyCategories(): string[] {
    return this.get<string[]>(STORAGE_KEYS.SUPPLY_CATEGORIES) || [
      'Gas',
      'Tools',
      'Materials',
      'Equipment',
    ];
  }

  addSupplyCategory(category: string): void {
    const categories = this.getSupplyCategories();
    if (!categories.includes(category)) {
      categories.push(category);
      this.set(STORAGE_KEYS.SUPPLY_CATEGORIES, categories);
    }
  }

  deleteSupplyCategory(category: string): void {
    const categories = this.getSupplyCategories().filter(c => c !== category);
    this.set(STORAGE_KEYS.SUPPLY_CATEGORIES, categories);
  }

  // Clear all data
  clearAll(): void {
    if (!this.isClient) return;
    localStorage.clear();
  }

  clearAllExceptAuth(): void {
    const token = this.getToken();
    const username = this.getUsername();
    
    this.clearAll();
    
    if (token) this.setToken(token);
    if (username) this.setUsername(username);
  }
}

export const storage = new LocalStorage();
