// src/lib/stores/auth.ts
import { writable, derived } from 'svelte/store';
import type { User } from '$lib/types';
import { storage } from '$lib/utils/storage';
import { api } from '$lib/utils/api';
import { trips } from './trips';

interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
}

// Helper to get/set offline ID
const getOfflineId = () => {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem('offline_user_id');
};

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>({
		user: null,
		isAuthenticated: false,
		isLoading: false,
		error: null
	});

	return {
		subscribe,

		/**
		 * HYDRATE: Manually set user state (e.g. from Server Load function)
		 * Fixes issue where Name/Email disappear on refresh by checking local storage.
		 */
		hydrate: (userData: User) => {
			let localName = '';
			let localEmail = '';

			if (typeof window !== 'undefined') {
				localName = storage.getUsername() || '';
				localEmail = localStorage.getItem('user_email') || '';
				if (userData.token) {
					storage.setToken(userData.token);
				}
			}

			// Merge: Server data takes precedence, but fall back to local if server is missing fields
			const mergedUser = {
				...userData,
				name: userData.name || localName,
				email: userData.email || localEmail
			};

			set({
				user: mergedUser,
				isAuthenticated: true,
				isLoading: false,
				error: null
			});
		},

		// Initialize auth state from localStorage on app start
		init: async () => {
			const token = storage.getToken();
			const username = storage.getUsername();
			const email = typeof window !== 'undefined' ? localStorage.getItem('user_email') : null;

			if (token) {
				update((state) => ({ ...state, isLoading: true }));
				try {
					const subscription = await api.getSubscription(token);

					const user: User = {
						token,
						plan: subscription.plan,
						tripsThisMonth: subscription.tripsThisMonth,
						maxTrips: subscription.maxTrips,
						resetDate: subscription.resetDate,
						name: username || '',
						email: email || ''
					};

					set({
						user,
						isAuthenticated: true,
						isLoading: false,
						error: null
					});

					await trips.syncFromCloud(token);
				} catch (error) {
					console.error('Failed to load user data:', error);
					set({
						user: null,
						isAuthenticated: false,
						isLoading: false,
						error: 'Session expired'
					});
				}
			} else {
				set({
					user: null,
					isAuthenticated: false,
					isLoading: false,
					error: null
				});
			}
		},

		// Update Profile - Saves to local storage immediately
		updateProfile: (data: { name?: string; email?: string }) => {
			update((state) => {
				if (!state.user) return state;

				const updatedUser = { ...state.user, ...data };

				if (typeof window !== 'undefined') {
					if (data.name) storage.setUsername(data.name);
					if (data.email) localStorage.setItem('user_email', data.email);
				}

				return {
					...state,
					user: updatedUser
				};
			});
		},

		// Sign up
		signup: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				const response = await api.signup(username, password);
				const offlineId = getOfflineId();

				storage.setToken(response.token);
				storage.setUsername(username);

				const subscription = await api.getSubscription(response.token);

				const user: User = {
					token: response.token,
					plan: subscription.plan,
					tripsThisMonth: subscription.tripsThisMonth,
					maxTrips: subscription.maxTrips,
					resetDate: subscription.resetDate,
					name: username,
					email: ''
				};

				set({
					user,
					isAuthenticated: true,
					isLoading: false,
					error: null
				});

				if (offlineId) {
					await trips.migrateOfflineTrips(offlineId, response.token);
					localStorage.removeItem('offline_user_id');
				}

				await trips.syncFromCloud(response.token);

				return { success: true, resetKey: response.resetKey };
			} catch (error: any) {
				update((state) => ({
					...state,
					isLoading: false,
					error: error.message || 'Signup failed'
				}));
				return { success: false, error: error.message };
			}
		},

		// Login
		login: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				const response = await api.login(username, password);
				const offlineId = getOfflineId();

				storage.setToken(response.token);
				storage.setUsername(username);
				const savedEmail = localStorage.getItem('user_email') || '';

				const subscription = await api.getSubscription(response.token);

				const user: User = {
					token: response.token,
					plan: subscription.plan,
					tripsThisMonth: subscription.tripsThisMonth,
					maxTrips: subscription.maxTrips,
					resetDate: subscription.resetDate,
					name: username,
					email: savedEmail
				};

				set({
					user,
					isAuthenticated: true,
					isLoading: false,
					error: null
				});

				if (offlineId) {
					await trips.migrateOfflineTrips(offlineId, response.token);
					localStorage.removeItem('offline_user_id');
				}

				await trips.syncFromCloud(response.token);

				return { success: true };
			} catch (error: any) {
				update((state) => ({
					...state,
					isLoading: false,
					error: error.message || 'Login failed'
				}));
				return { success: false, error: error.message };
			}
		},

		// Logout
		logout: () => {
			storage.clearToken();
			storage.clearUsername();
			if (typeof window !== 'undefined') localStorage.removeItem('user_email');

			set({
				user: null,
				isAuthenticated: false,
				isLoading: false,
				error: null
			});
		},

		// Change password
		changePassword: async (username: string, currentPassword: string, newPassword: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				await api.changePassword(username, currentPassword, newPassword);
				update((state) => ({ ...state, isLoading: false, error: null }));
				return { success: true };
			} catch (error: any) {
				update((state) => ({
					...state,
					isLoading: false,
					error: error.message || 'Password change failed'
				}));
				return { success: false, error: error.message };
			}
		},

		// Reset password
		resetPassword: async (username: string, resetKey: string, newPassword: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				await api.resetPassword(username, resetKey, newPassword);
				update((state) => ({ ...state, isLoading: false, error: null }));
				return { success: true };
			} catch (error: any) {
				update((state) => ({
					...state,
					isLoading: false,
					error: error.message || 'Password reset failed'
				}));
				return { success: false, error: error.message };
			}
		},

		// Delete Account - Uses local proxy /api/user to bypass CORS
		deleteAccount: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));

			try {
				const token = storage.getToken();

				// Call local server route (proxy) instead of external API directly
				const response = await fetch('/api/user', {
					method: 'DELETE',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: token } : {})
					},
					body: JSON.stringify({ username, password })
				});

				if (!response.ok) {
					const data = await response.json().catch(() => ({}));
					throw new Error(data.error || 'Account deletion failed');
				}

				// Clean up local data
				storage.clearAll();
				if (typeof window !== 'undefined') localStorage.removeItem('user_email');
				trips.clear();

				set({
					user: null,
					isAuthenticated: false,
					isLoading: false,
					error: null
				});

				return { success: true };
			} catch (error: any) {
				update((state) => ({
					...state,
					isLoading: false,
					error: error.message || 'Account deletion failed'
				}));
				return { success: false, error: error.message };
			}
		},

		// Refresh subscription data
		refreshSubscription: async () => {
			const token = storage.getToken();
			if (!token) return;

			try {
				const subscription = await api.getSubscription(token);
				update((state) => ({
					...state,
					user: state.user
						? {
								...state.user,
								plan: subscription.plan,
								tripsThisMonth: subscription.tripsThisMonth,
								maxTrips: subscription.maxTrips,
								resetDate: subscription.resetDate
							}
						: null
				}));
			} catch (error) {
				console.error('Failed to refresh subscription:', error);
			}
		},

		// Clear error
		clearError: () => {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const auth = createAuthStore();

// Derived stores
export const user = derived(auth, ($auth) => $auth.user);
export const isAuthenticated = derived(auth, ($auth) => $auth.isAuthenticated);
export const isLoading = derived(auth, ($auth) => $auth.isLoading);
export const authError = derived(auth, ($auth) => $auth.error);

// Helper to check if user can create more trips
export const canCreateTrip = derived(user, ($user) => {
	if (!$user) return true; // Unauthenticated users can use local storage
	if ($user.plan === 'pro' || $user.plan === 'business') return true; // Unlimited
	return $user.tripsThisMonth < $user.maxTrips; // Free plan check
});
