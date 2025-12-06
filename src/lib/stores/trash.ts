// src/lib/stores/trash.ts
import { writable } from 'svelte/store';
import type { Trip } from '$lib/types';

export type TrashedTrip = Trip & {
	deletedAt: string;
	metadata: {
		deletedAt: string;
		deletedBy: string;
		originalKey: string;
		expiresAt: string;
	};
};

function createTrashStore() {
	const { subscribe, set, update } = writable<TrashedTrip[]>([]);

	return {
		subscribe,

		/**
		 * Load all trashed trips
		 */
		async load() {
			try {
				const res = await fetch('/api/trash');
				if (!res.ok) {
					throw new Error(`Failed to load trash: ${res.statusText}`);
				}
				const data = await res.json();
				set(data);
				return data;
			} catch (e) {
				console.error('loadTrash error:', e);
				set([]);
				return [];
			}
		},

		/**
		 * Restore a trip from trash
		 */
		async restore(id: string) {
			try {
				const res = await fetch(`/api/trash/${id}/restore`, {
					method: 'POST'
				});

				if (!res.ok) {
					throw new Error(`Failed to restore trip: ${res.statusText}`);
				}

				const restored = await res.json();
				
				// Remove from trash
				update((items) => items.filter((t) => t.id !== id));
				
				return restored;
			} catch (e) {
				console.error('restoreTrip error:', e);
				throw e;
			}
		},

		/**
		 * Permanently delete a trip from trash
		 */
		async permanentDelete(id: string) {
			try {
				const res = await fetch(`/api/trash/${id}`, {
					method: 'DELETE'
				});

				if (!res.ok && res.status !== 204) {
					throw new Error(`Failed to permanently delete: ${res.statusText}`);
				}

				update((items) => items.filter((t) => t.id !== id));
				return true;
			} catch (e) {
				console.error('permanentDelete error:', e);
				throw e;
			}
		},

		/**
		 * Empty entire trash (permanently delete all)
		 */
		async emptyAll() {
			try {
				const res = await fetch('/api/trash', {
					method: 'DELETE'
				});

				if (!res.ok) {
					throw new Error(`Failed to empty trash: ${res.statusText}`);
				}

				const result = await res.json();
				set([]);
				return result;
			} catch (e) {
				console.error('emptyTrash error:', e);
				throw e;
			}
		},

		/**
		 * Get count of items in trash
		 */
		async getCount() {
			try {
				const res = await fetch('/api/trash');
				if (!res.ok) return 0;
				const data = await res.json();
				return data.length;
			} catch (e) {
				return 0;
			}
		}
	};
}

export const trash = createTrashStore();
