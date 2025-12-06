// src/lib/stores/trips.ts
import { writable } from 'svelte/store';
import type { Trip } from '$lib/types';

function createTripsStore() {
	const { subscribe, set, update } = writable<Trip[]>([]);

	return {
		subscribe,

		/**
		 * Load all trips from the server
		 */
		async load() {
			try {
				const res = await fetch('/api/trips');
				if (!res.ok) {
					throw new Error(`Failed to load trips: ${res.statusText}`);
				}
				const data = await res.json();
				set(data);
				return data;
			} catch (e) {
				console.error('loadTrips error:', e);
				set([]);
				return [];
			}
		},

		/**
		 * Create a new trip
		 */
		async add(payload: Partial<Trip>) {
			try {
				const res = await fetch('/api/trips', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});

				if (!res.ok) {
					throw new Error(`Failed to create trip: ${res.statusText}`);
				}

				const created = await res.json();
				update((trips) => [created, ...trips]);
				return created;
			} catch (e) {
				console.error('createTrip error:', e);
				throw e;
			}
		},

		/**
		 * Update an existing trip
		 */
		async updateTrip(id: string, payload: Partial<Trip>) {
			try {
				const res = await fetch(`/api/trips/${id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});

				if (!res.ok) {
					throw new Error(`Failed to update trip: ${res.statusText}`);
				}

				const updated = await res.json();
				update((trips) => trips.map((t) => (t.id === id ? updated : t)));
				return updated;
			} catch (e) {
				console.error('updateTrip error:', e);
				throw e;
			}
		},

		/**
		 * Delete a trip
		 */
		async delete(id: string) {
			try {
				const res = await fetch(`/api/trips/${id}`, {
					method: 'DELETE'
				});

				if (!res.ok && res.status !== 204) {
					throw new Error(`Failed to delete trip: ${res.statusText}`);
				}

				update((trips) => trips.filter((t) => t.id !== id));
				return true;
			} catch (e) {
				console.error('deleteTrip error:', e);
				throw e;
			}
		},

		/**
		 * Get a single trip by ID
		 */
		async get(id: string) {
			try {
				const res = await fetch(`/api/trips/${id}`);
				if (!res.ok) {
					throw new Error(`Failed to get trip: ${res.statusText}`);
				}
				return await res.json();
			} catch (e) {
				console.error('getTrip error:', e);
				throw e;
			}
		}
	};
}

export const trips = createTripsStore();

// Convenience exports for backward compatibility
export const loadTrips = () => trips.load();
export const createTrip = (payload: Partial<Trip>) => trips.add(payload);
export const updateTrip = (id: string, payload: Partial<Trip>) => trips.updateTrip(id, payload);
export const deleteTrip = (id: string) => trips.delete(id);
