// src/lib/stores/auth.ts

import { writable, derived } from 'svelte/store';
import type { User, Subscription } from '$lib/types';
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
    error: null,
  });

  return {
    subscribe,

    /**
     * HYDRATE: Manually set user state (e.g. from Server Load function)
     * This fixes the issue of state being lost on refresh.
     */
    hydrate: (userData: User) => {
        // Update store
        set({
            user: userData,
            isAuthenticated: true,
            isLoading: false,
            error: null,
        });
        
        // Sync to localStorage so it persists if we do client-side navigation
        if (typeof window !== 'undefined' && userData.token) {
            storage.setToken(userData.token);
            // If user has a name/email, we could store that too, but token is key
        }
    },

    // Initialize auth state from localStorage
    init: async () => {
      const token = storage.getToken();
      const username = storage.getUsername();

      if (token) {
        update(state => ({ ...state, isLoading: true }));
        
        try {
          // Verify token / get latest details
          const subscription = await api.getSubscription(token);
          
          const user: User = {
            token,
            plan: subscription.plan,
            tripsThisMonth: subscription.tripsThisMonth,
            maxTrips: subscription.maxTrips,
            resetDate: subscription.resetDate,
            // Add name/email if your API returns them or you stored them
            name: username || 'User' 
          };

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          // Sync trips from cloud
          await trips.syncFromCloud(token);
        } catch (error) {
          console.error('Failed to load user data:', error);
          // Don't clear token immediately on network error, only on 401
          // But for now, we assume invalid token
          // storage.clearToken(); 
          
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: 'Session expired',
          });
        }
      } else {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      }
    },

    // Sign up
    signup: async (username: string, password: string) => {
      update(state => ({ ...state, isLoading: true, error: null }));

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
          name: username
        };

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        // Migrate offline data
        if (offlineId) {
            await trips.migrateOfflineTrips(offlineId, response.token);
            localStorage.removeItem('offline_user_id');
        }

        await trips.syncFromCloud(response.token);

        return { success: true, resetKey: response.resetKey };
      } catch (error: any) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Signup failed',
        }));
        return { success: false, error: error.message };
      }
    },

    // Login
    login: async (username: string, password: string) => {
      update(state => ({ ...state, isLoading: true, error: null }));

      try {
        const response = await api.login(username, password);
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
          name: username
        };

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        // Migrate offline data
        if (offlineId) {
            await trips.migrateOfflineTrips(offlineId, response.token);
            localStorage.removeItem('offline_user_id');
        }

        await trips.syncFromCloud(response.token);

        return { success: true };
      } catch (error: any) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Login failed',
        }));
        return { success: false, error: error.message };
      }
    },

    // Logout
    logout: () => {
      storage.clearToken();
      storage.clearUsername();
      
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    },

    // Change password
    changePassword: async (username: string, currentPassword: string, newPassword: string) => {
      update(state => ({ ...state, isLoading: true, error: null }));

      try {
        await api.changePassword(username, currentPassword, newPassword);
        update(state => ({ ...state, isLoading: false, error: null }));
        return { success: true };
      } catch (error: any) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Password change failed',
        }));
        return { success: false, error: error.message };
      }
    },

    // Reset password
    resetPassword: async (username: string, resetKey: string, newPassword: string) => {
      update(state => ({ ...state, isLoading: true, error: null }));

      try {
        await api.resetPassword(username, resetKey, newPassword);
        update(state => ({ ...state, isLoading: false, error: null }));
        return { success: true };
      } catch (error: any) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Password reset failed',
        }));
        return { success: false, error: error.message };
      }
    },

    // Delete account
    deleteAccount: async (username: string, password: string) => {
      update(state => ({ ...state, isLoading: true, error: null }));

      try {
        await api.deleteAccount(username, password);
        storage.clearAll();
        trips.clear();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        return { success: true };
      } catch (error: any) {
        update(state => ({
          ...state,
          isLoading: false,
          error: error.message || 'Account deletion failed',
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
        update(state => ({
          ...state,
          user: state.user ? {
            ...state.user,
            plan: subscription.plan,
            tripsThisMonth: subscription.tripsThisMonth,
            maxTrips: subscription.maxTrips,
            resetDate: subscription.resetDate,
          } : null,
        }));
      } catch (error) {
        console.error('Failed to refresh subscription:', error);
      }
    },

    // Clear error
    clearError: () => {
      update(state => ({ ...state, error: null }));
    },
  };
}

export const auth = createAuthStore();

// Derived stores
export const user = derived(auth, $auth => $auth.user);
export const isAuthenticated = derived(auth, $auth => $auth.isAuthenticated);
export const isLoading = derived(auth, $auth => $auth.isLoading);
export const authError = derived(auth, $auth => $auth.error);

// Helper to check if user can create more trips
export const canCreateTrip = derived(user, $user => {
  if (!$user) return true; 
  if ($user.plan === 'pro' || $user.plan === 'business') return true; 
  return $user.tripsThisMonth < $user.maxTrips; 
});