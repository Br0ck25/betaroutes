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

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });

  return {
    subscribe,

    // Initialize auth state from localStorage
    init: async () => {
      const token = storage.getToken();
      const username = storage.getUsername();

      if (token && username) {
        update(state => ({ ...state, isLoading: true }));
        
        try {
          const subscription = await api.getSubscription(token);
          
          const user: User = {
            token,
            plan: subscription.plan,
            tripsThisMonth: subscription.tripsThisMonth,
            maxTrips: subscription.maxTrips,
            resetDate: subscription.resetDate,
          };

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });

          // Sync trips from cloud
          await trips.syncFromCloud();
        } catch (error) {
          console.error('Failed to load user data:', error);
          storage.clearToken();
          storage.clearUsername();
          
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
        
        storage.setToken(response.token);
        storage.setUsername(username);

        const subscription = await api.getSubscription(response.token);

        const user: User = {
          token: response.token,
          plan: subscription.plan,
          tripsThisMonth: subscription.tripsThisMonth,
          maxTrips: subscription.maxTrips,
          resetDate: subscription.resetDate,
        };

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        // Sync local trips to cloud
        await trips.syncToCloud();

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
        
        storage.setToken(response.token);
        storage.setUsername(username);

        const subscription = await api.getSubscription(response.token);

        const user: User = {
          token: response.token,
          plan: subscription.plan,
          tripsThisMonth: subscription.tripsThisMonth,
          maxTrips: subscription.maxTrips,
          resetDate: subscription.resetDate,
        };

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        // Sync trips from cloud
        await trips.syncFromCloud();

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
        
        // Clear all local data
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
  if (!$user) return true; // Unauthenticated users can use local storage
  if ($user.plan === 'pro' || $user.plan === 'business') return true; // Unlimited
  return $user.tripsThisMonth < $user.maxTrips; // Free plan check
});
