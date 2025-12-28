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

const getOfflineId = () => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('offline_user_id');
};

// Helper: Cache user data for offline access
const saveUserCache = (user: User) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('user_cache', JSON.stringify(user));
  }
};

// Helper: Retrieve cached user data
const getUserCache = (): User | null => {
  if (typeof window === 'undefined') return null;
  const cached = localStorage.getItem('user_cache');
  return cached ? JSON.parse(cached) : null;
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
        localEmail = localStorage.getItem('user_email') || '';
        if (userData.token) {
          storage.setToken(userData.token);
        }
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
      const token = storage.getToken();
      const username = storage.getUsername();
      const email = typeof window !== 'undefined' ? localStorage.getItem('user_email') : null;

      if (token) {
        update((state) => ({ ...state, isLoading: true }));
        try {
          // 1. Try fetching fresh data from API
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

          // Success: Update offline cache
          saveUserCache(user);

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });

          const syncId = user.name || user.token;
          await trips.syncFromCloud(syncId);
        } catch (error) {
          console.warn('Failed to load user data, checking offline cache...', error);
          
          // 2. Fallback to offline cache if API fails
          const cachedUser = getUserCache();
          
          // Only use cache if the token matches (simple security check)
          if (cachedUser && cachedUser.token === token) {
             console.log('✅ Restored user session from offline cache');
             set({
               user: cachedUser,
               isAuthenticated: true,
               isLoading: false,
               error: null // Do not show error so app works normally
             });
             
             // Load local trips immediately
             await trips.load(cachedUser.name || cachedUser.token);
          } else {
             set({
                user: null,
                isAuthenticated: false,
                isLoading: false,
                error: 'Session expired'
             });
          }
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

    updateProfile: (data: { name?: string; email?: string }) => {
      update((state) => {
        if (!state.user) return state;

        const updatedUser = { ...state.user, ...data };

        if (typeof window !== 'undefined') {
          if (data.name) storage.setUsername(data.name);
          if (data.email) localStorage.setItem('user_email', data.email);
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
        
        saveUserCache(user);

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null
        });

        if (offlineId) {
          await trips.migrateOfflineTrips(offlineId, username);
          localStorage.removeItem('offline_user_id');
        }

        await trips.syncFromCloud(username);

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
        
        saveUserCache(user);

        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null
        });

        if (offlineId) {
          await trips.migrateOfflineTrips(offlineId, username);
          localStorage.removeItem('offline_user_id');
        }

        await trips.syncFromCloud(username);

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

    logout: () => {
      storage.clearToken();
      storage.clearUsername();
      if (typeof window !== 'undefined') {
          localStorage.removeItem('user_email');
          localStorage.removeItem('user_cache'); // Clear cache
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
        const token = storage.getToken();

        const response = await fetch('/api/user', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token } : {})
          },
          body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
          const data: any = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Account deletion failed');
        }

        storage.clearAll();
        if (typeof window !== 'undefined') {
            localStorage.removeItem('user_email');
            localStorage.removeItem('user_cache');
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
      const token = storage.getToken();
      if (!token) return;

      try {
        const subscription = await api.getSubscription(token);
        update((state) => {
            if(!state.user) return state;
            const updated = {
                ...state.user,
                plan: subscription.plan,
                tripsThisMonth: subscription.tripsThisMonth,
                maxTrips: subscription.maxTrips,
                resetDate: subscription.resetDate
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
  return $user.tripsThisMonth < $user.maxTrips;
});