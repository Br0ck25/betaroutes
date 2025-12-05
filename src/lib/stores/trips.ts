// src/lib/stores/trips.ts

import { writable, derived, get } from 'svelte/store';
import type { Trip, TripFilters, TripStats } from '$lib/types';
import { storage } from '$lib/utils/storage';
import { api } from '$lib/utils/api';

function createTripsStore() {
  const { subscribe, set, update } = writable<Trip[]>([]);

  // Load trips from localStorage on init
  if (typeof window !== 'undefined') {
    const savedTrips = storage.getTrips();
    set(savedTrips);
  }

  return {
    subscribe,
    
    // Load trips from localStorage
    load: () => {
      const trips = storage.getTrips();
      set(trips);
    },

    // Sync from cloud (for authenticated users)
    syncFromCloud: async () => {
      try {
        const cloudTrips = await api.getTrips();
        const localTrips = storage.getTrips();
        
        // Merge: prefer cloud trips, but keep local ones not in cloud
        const merged = [...cloudTrips];
        
        localTrips.forEach(localTrip => {
          const existsInCloud = cloudTrips.some(
            cloudTrip => cloudTrip.id === localTrip.id
          );
          if (!existsInCloud) {
            merged.push(localTrip);
          }
        });
        
        // Sort by date (newest first)
        merged.sort((a, b) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        );
        
        storage.saveTrips(merged);
        storage.setCachedLogs(cloudTrips);
        set(merged);
        
        return merged;
      } catch (error) {
        console.error('Failed to sync from cloud:', error);
        // If sync fails, return local trips
        const localTrips = storage.getTrips();
        set(localTrips);
        return localTrips;
      }
    },

    // Sync to cloud (for authenticated users)
    syncToCloud: async () => {
      try {
        const trips = storage.getTrips();
        await api.saveTrips(trips);
        storage.setCachedLogs(trips);
      } catch (error) {
        console.error('Failed to sync to cloud:', error);
        throw error;
      }
    },

    // Add a new trip
    add: (trip: Trip) => {
      update(trips => {
        const newTrips = [trip, ...trips];
        storage.saveTrips(newTrips);
        return newTrips;
      });
      
      // Try to sync to cloud if authenticated
      if (storage.getToken()) {
        api.saveTrips(get({ subscribe })).catch(err => 
          console.error('Failed to sync new trip:', err)
        );
      }
    },

    // Update existing trip
    updateTrip: (id: string, updatedTrip: Trip) => {
      update(trips => {
        const index = trips.findIndex(t => t.id === id);
        if (index !== -1) {
          trips[index] = { ...updatedTrip, lastModified: new Date().toISOString() };
          storage.saveTrips(trips);
        }
        return trips;
      });
      
      // Try to sync to cloud if authenticated
      if (storage.getToken()) {
        api.saveTrips(get({ subscribe })).catch(err => 
          console.error('Failed to sync updated trip:', err)
        );
      }
    },

    // Delete trip
    delete: (id: string) => {
      update(trips => {
        const filtered = trips.filter(t => t.id !== id);
        storage.saveTrips(filtered);
        return filtered;
      });
      
      // Try to sync to cloud if authenticated
      if (storage.getToken()) {
        api.saveTrips(get({ subscribe })).catch(err => 
          console.error('Failed to sync after delete:', err)
        );
      }
    },

    // Clear all trips
    clear: () => {
      storage.saveTrips([]);
      set([]);
    },
  };
}

export const trips = createTripsStore();

// Filtered trips store
export const filteredTrips = derived(
  trips,
  ($trips) => $trips // Default: return all trips
);

// Create a writable store for filters
export const tripFilters = writable<TripFilters>({
  startDate: undefined,
  endDate: undefined,
  searchQuery: undefined,
  minProfit: undefined,
  maxProfit: undefined,
});

// Derived store that applies filters
export const filteredTripsWithFilters = derived(
  [trips, tripFilters],
  ([$trips, $filters]) => {
    let filtered = [...$trips];

    // Date range filter
    if ($filters.startDate) {
      filtered = filtered.filter(t => t.date >= $filters.startDate!);
    }
    if ($filters.endDate) {
      filtered = filtered.filter(t => t.date <= $filters.endDate!);
    }

    // Search filter (searches in addresses, notes)
    if ($filters.searchQuery) {
      const query = $filters.searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.startAddress.toLowerCase().includes(query) ||
        t.endAddress.toLowerCase().includes(query) ||
        t.destinations.some(d => d.address.toLowerCase().includes(query)) ||
        (t.notes && t.notes.toLowerCase().includes(query))
      );
    }

    // Profit range filter
    if ($filters.minProfit !== undefined) {
      filtered = filtered.filter(t => t.netProfit >= $filters.minProfit!);
    }
    if ($filters.maxProfit !== undefined) {
      filtered = filtered.filter(t => t.netProfit <= $filters.maxProfit!);
    }

    return filtered;
  }
);

// Trip statistics (derived from filtered trips)
export const tripStats = derived(
  filteredTripsWithFilters,
  ($trips): TripStats => {
    if ($trips.length === 0) {
      return {
        totalProfit: 0,
        totalTrips: 0,
        avgProfitPerHour: 0,
        totalMiles: 0,
        totalFuelCost: 0,
        totalMaintenanceCost: 0,
        totalSuppliesCost: 0,
      };
    }

    const totalProfit = $trips.reduce((sum, t) => sum + t.netProfit, 0);
    const totalMiles = $trips.reduce((sum, t) => sum + t.totalMileage, 0);
    const totalFuelCost = $trips.reduce((sum, t) => sum + t.fuelCost, 0);
    const totalMaintenanceCost = $trips.reduce((sum, t) => sum + t.maintenanceCost, 0);
    const totalSuppliesCost = $trips.reduce((sum, t) => sum + t.suppliesCost, 0);
    
    const totalHours = $trips.reduce((sum, t) => sum + (t.hoursWorked || 0), 0);
    const avgProfitPerHour = totalHours > 0 ? totalProfit / totalHours : 0;

    return {
      totalProfit: Number(totalProfit.toFixed(2)),
      totalTrips: $trips.length,
      avgProfitPerHour: Number(avgProfitPerHour.toFixed(2)),
      totalMiles: Number(totalMiles.toFixed(2)),
      totalFuelCost: Number(totalFuelCost.toFixed(2)),
      totalMaintenanceCost: Number(totalMaintenanceCost.toFixed(2)),
      totalSuppliesCost: Number(totalSuppliesCost.toFixed(2)),
    };
  }
);

// Draft trip store (for auto-save)
function createDraftStore() {
  const { subscribe, set, update } = writable<Partial<Trip> | null>(null);

  // Load draft on init
  if (typeof window !== 'undefined') {
    const draft = storage.getDraftTrip();
    set(draft);
  }

  return {
    subscribe,
    
    save: (draft: Partial<Trip>) => {
      storage.saveDraftTrip(draft);
      set(draft);
    },
    
    clear: () => {
      storage.clearDraftTrip();
      set(null);
    },
    
    load: () => {
      const draft = storage.getDraftTrip();
      set(draft);
      return draft;
    },
  };
}

export const draftTrip = createDraftStore();
