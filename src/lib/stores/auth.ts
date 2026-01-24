// src/lib/stores/auth.ts
import { writable, derived } from 'svelte/store';
import type { User, AuthResponse } from '$lib/types';
import { storage } from '$lib/utils/storage';
import { api } from '$lib/utils/api';
import { trips } from './trips';
import { csrfFetch } from '$lib/utils/csrf';

interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
}

const getOfflineId = () => {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem('offline_user_id');
};

// [SECURITY FIX #54] Cache user data in sessionStorage instead of localStorage
// sessionStorage clears on tab close, reducing XSS exposure window
const saveUserCache = (user: User) => {
	if (typeof window !== 'undefined') {
		// Only cache non-sensitive display data
		const safeCache = {
			id: user.id, // [!code fix] Cache the UUID
			plan: user.plan,
			tripsThisMonth: user.tripsThisMonth,
			maxTrips: user.maxTrips,
			resetDate: user.resetDate,
			name: user.name || ''
			// Note: email and token are NOT cached
		};
		sessionStorage.setItem('user_cache', JSON.stringify(safeCache));
	}
};

// Helper: Retrieve cached user data
const getUserCache = (): User | null => {
	if (typeof window === 'undefined') return null;
	const cached = sessionStorage.getItem('user_cache');
	if (!cached) return null;
	try {
		const parsed = JSON.parse(cached);

		// [!code fix] CRITICAL: Invalidate cache if ID is missing.
		// This forces a fresh fetch from the server to get the correct UUID.
		if (!parsed.id) {
			sessionStorage.removeItem('user_cache');
			return null;
		}

		return {
			id: parsed.id, // [!code fix] Restore the UUID
			token: '', // Never cached
			plan: parsed.plan || 'free',
			tripsThisMonth: parsed.tripsThisMonth ?? 0,
			maxTrips: parsed.maxTrips ?? 10,
			resetDate: parsed.resetDate || '',
			name: parsed.name || ''
		};
	} catch {
		return null;
	}
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

		hydrate: (userData: User) => {
			let localName = '';
			let localEmail = '';

			if (typeof window !== 'undefined') {
				localName = storage.getUsername() || '';
				// [SECURITY FIX #54] Email now in sessionStorage, not localStorage
				localEmail = sessionStorage.getItem('user_email') || '';
				// [SECURITY FIX #52] Session tokens are now in httpOnly cookies
				// No need to store token in localStorage
			}

			const mergedUser = {
				...userData,
				name: userData.name || localName,
				email: userData.email || localEmail
			};

			// Update cache on hydration
			saveUserCache(mergedUser);

			set({
				user: mergedUser,
				isAuthenticated: true,
				isLoading: false,
				error: null
			});
		},

		init: async () => {
			// [SECURITY FIX #52] Session tokens are now in httpOnly cookies
			// Check authentication status via server call instead of localStorage
			const username = storage.getUsername();
			// [SECURITY FIX #54] Email now in sessionStorage, not localStorage
			const email = typeof window !== 'undefined' ? sessionStorage.getItem('user_email') : null;

			// Try to verify session with server (cookies sent automatically)
			update((state) => ({ ...state, isLoading: true }));
			try {
				const response = await fetch('/api/auth/session', {
					method: 'GET',
					credentials: 'include'
				});

				if (response.ok) {
					const responseData = (await response.json()) as { user?: Partial<User> };
					const data = responseData.user || {};
					const user: User = {
						id: data.id, // [!code fix] Critical: Capture UUID from server session
						token: '', // No longer stored client-side
						plan: data.plan || 'free',
						tripsThisMonth: data.tripsThisMonth ?? 0,
						maxTrips: data.maxTrips ?? 10,
						resetDate: data.resetDate || '',
						name: data.name || username || '',
						email: data.email || email || ''
					};

					// Success: Update offline cache
					saveUserCache(user);

					set({
						user,
						isAuthenticated: true,
						isLoading: false,
						error: null
					});

					// Prefer ID for sync, fallback to name for legacy support
					const syncId = user.id || user.name || 'user';
					if (syncId) await trips.syncFromCloud(syncId);
				} else {
					// Not authenticated - check offline cache
					const cachedUser = getUserCache();
					if (cachedUser && username) {
						console.log('✅ Restored user session from offline cache');
						set({
							user: cachedUser,
							isAuthenticated: true,
							isLoading: false,
							error: null
						});
						await trips.load(cachedUser.id || cachedUser.name || 'user');
					} else {
						set({
							user: null,
							isAuthenticated: false,
							isLoading: false,
							error: null
						});
					}
				}
			} catch (error) {
				console.warn('Failed to verify session, checking offline cache...', error);

				// Fallback to offline cache if server unreachable
				const cachedUser = getUserCache();
				if (cachedUser && username) {
					console.log('✅ Restored user session from offline cache');
					set({
						user: cachedUser,
						isAuthenticated: true,
						isLoading: false,
						error: null
					});
					await trips.load(cachedUser.id || cachedUser.name || 'user');
				} else {
					set({
						user: null,
						isAuthenticated: false,
						isLoading: false,
						error: null
					});
				}
			}
		},

		updateProfile: (data: { name?: string; email?: string }) => {
			update((state) => {
				if (!state.user) return state;

				const updatedUser = { ...state.user, ...data };

				if (typeof window !== 'undefined') {
					if (data.name) storage.setUsername(data.name);
					// [SECURITY FIX #54] Email now in sessionStorage, not localStorage
					if (data.email) sessionStorage.setItem('user_email', data.email);
					saveUserCache(updatedUser); // Keep cache in sync
				}

				return {
					...state,
					user: updatedUser
				};
			});
		},

		signup: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				const response = (await api.signup(username, password)) as AuthResponse;
				const offlineId = getOfflineId();

				// [SECURITY FIX #52] Only store username, not token
				storage.setUsername(username);

				// Create server-side session so cloud endpoints (/api/trips) are authorized
				try {
					await fetch('/login', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: username, password })
					});
				} catch (e) {
					console.warn('Failed to create server session after signup:', e);
				}

				const subscription = await api.getSubscription(response.token || '');
				const user: User = {
					id: response.id, // [!code fix] Capture UUID from signup response
					token: response.token || '',
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
					await trips.migrateOfflineTrips(offlineId, user.id || username);
					localStorage.removeItem('offline_user_id');
				}

				await trips.syncFromCloud(user.id || username);

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

		login: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));
			try {
				const response = (await api.login(username, password)) as AuthResponse;
				const offlineId = getOfflineId();

				// [SECURITY FIX #52] Only store username, not token
				storage.setUsername(username);

				// Create server-side session cookie so /api/trips and other server endpoints recognize the user
				try {
					await fetch('/login', {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: username, password })
					});
				} catch (e) {
					console.warn('Failed to create server session on login:', e);
				}

				// [SECURITY FIX #54] Email now in sessionStorage, not localStorage
				const savedEmail =
					typeof window !== 'undefined' ? sessionStorage.getItem('user_email') || '' : '';
				const subscription = await api.getSubscription(response.token || '');

				const user: User = {
					id: response.id, // [!code fix] Capture UUID from login response
					token: response.token || '',
					plan: subscription.plan,
					tripsThisMonth: subscription.tripsThisMonth,
					maxTrips: subscription.maxTrips,
					resetDate: subscription.resetDate,
					name: username,
					email: savedEmail
				};
				saveUserCache(user);

				set({
					user,
					isAuthenticated: true,
					isLoading: false,
					error: null
				});

				if (offlineId) {
					await trips.migrateOfflineTrips(offlineId, user.id || username);
					localStorage.removeItem('offline_user_id');
				}

				await trips.syncFromCloud(user.id || username);

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

		logout: async () => {
			// [SECURITY FIX #52] Clear server session (cookie cleared server-side)
			try {
				await fetch('/logout', {
					method: 'POST',
					credentials: 'include'
				});
			} catch (e) {
				console.warn('Failed to clear server session:', e);
			}

			storage.clearUsername();
			// [SECURITY FIX #54] Clear from sessionStorage, not localStorage
			if (typeof window !== 'undefined') {
				sessionStorage.removeItem('user_email');
				sessionStorage.removeItem('user_cache');
			}

			set({
				user: null,
				isAuthenticated: false,
				isLoading: false,
				error: null
			});
		},

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

		deleteAccount: async (username: string, password: string) => {
			update((state) => ({ ...state, isLoading: true, error: null }));

			try {
				// [SECURITY FIX #52] Use credentials:include for cookie-based auth
				const response = await csrfFetch('/api/user', {
					method: 'DELETE',
					credentials: 'include',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ username, password })
				});

				if (!response.ok) {
					const data: any = await response.json().catch(() => ({}));
					throw new Error(data.error || 'Account deletion failed');
				}

				storage.clearAll();
				// [SECURITY FIX #54] Clear from sessionStorage, not localStorage
				if (typeof window !== 'undefined') {
					sessionStorage.removeItem('user_email');
					sessionStorage.removeItem('user_cache');
				}
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

		refreshSubscription: async () => {
			// [SECURITY FIX #52] Use server session via credentials:include
			try {
				const response = await fetch('/api/auth/session', {
					method: 'GET',
					credentials: 'include'
				});

				if (!response.ok) return;

				const data = (await response.json()) as { user?: Partial<User> };
				if (!data.user) return;

				update((state) => {
					if (!state.user) return state;
					const updated: User = {
						...state.user,
						id: data.user?.id || state.user.id, // [!code fix] Ensure ID is preserved/updated
						plan: data.user?.plan || state.user.plan,
						tripsThisMonth: data.user?.tripsThisMonth ?? state.user.tripsThisMonth,
						maxTrips: data.user?.maxTrips ?? state.user.maxTrips,
						resetDate: data.user?.resetDate || state.user.resetDate
					};
					saveUserCache(updated); // Update cache
					return { ...state, user: updated };
				});
			} catch (error) {
				console.error('Failed to refresh subscription:', error);
			}
		},

		clearError: () => {
			update((state) => ({ ...state, error: null }));
		}
	};
}

export const auth = createAuthStore();

export const user = derived(auth, ($auth) => $auth.user);
export const isAuthenticated = derived(auth, ($auth) => $auth.isAuthenticated);
export const isLoading = derived(auth, ($auth) => $auth.isLoading);
export const authError = derived(auth, ($auth) => $auth.error);

export const canCreateTrip = derived(user, ($user) => {
	if (!$user) return true;
	if ($user.plan === 'pro' || $user.plan === 'business') return true;
	return ($user.tripsThisMonth ?? 0) < ($user.maxTrips ?? Infinity);
});
