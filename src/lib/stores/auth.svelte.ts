import type { AuthResponse, User } from '$lib/types';
import { api } from '$lib/utils/api';
import { csrfFetch } from '$lib/utils/csrf';
import { storage } from '$lib/utils/storage';
import { trips } from './trips';
// Minimal (no-dependency) store adapter for compatibility with legacy consumers
function createCompatibilityStore<T>(
  getter: () => T,
  subscribeEffect: (set: (v: T) => void) => void | (() => void)
) {
  return {
    subscribe(run: (v: T) => void) {
      // Emit initial value synchronously
      run(getter());
      const cleanup = subscribeEffect(run);
      return typeof cleanup === 'function' ? cleanup : () => {};
    }
  } as { subscribe: (run: (v: T) => void) => () => void };
}

// --- Cache helpers (kept same behavior as previous implementation) ---
const saveUserCache = (user: User) => {
  if (typeof window !== 'undefined') {
    const safeCache = {
      id: user.id,
      plan: user.plan,
      tripsThisMonth: user.tripsThisMonth,
      maxTrips: user.maxTrips,
      resetDate: user.resetDate,
      name: user.name || ''
    };
    sessionStorage.setItem('user_cache', JSON.stringify(safeCache));
  }
};

const getUserCache = (): User | null => {
  if (typeof window === 'undefined') return null;
  const cached = sessionStorage.getItem('user_cache');
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached);
    if (!parsed.id) {
      sessionStorage.removeItem('user_cache');
      return null;
    }

    return {
      id: parsed.id,
      token: '',
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

export class AuthState {
  user = $state<User | null>(null);
  isLoading = $state(false);
  error = $state<string | null>(null);

  get isAuthenticated() {
    return Boolean(this.user);
  }

  hydrate(userData: User) {
    let localName = '';
    let localEmail = '';

    if (typeof window !== 'undefined') {
      localName = storage.getUsername() || '';
      localEmail = sessionStorage.getItem('user_email') || '';
    }

    const mergedUser: User = {
      ...userData,
      name: userData.name || localName,
      email: userData.email || localEmail
    };

    saveUserCache(mergedUser);

    this.user = mergedUser;
    this.isLoading = false;
    this.error = null;
  }

  async init() {
    const username = storage.getUsername();
    const email = typeof window !== 'undefined' ? sessionStorage.getItem('user_email') : null;

    this.isLoading = true;
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include'
      });

      if (response.ok) {
        const responseData = (await response.json()) as { user?: Partial<User> };
        const data = responseData.user || {};

        if (!data || !data.id) {
          console.warn('Session response missing user id; treating as unauthenticated');
          this.user = null;
          this.isLoading = false;
          this.error = null;
          return;
        }

        const user: User = {
          id: String(data.id),
          token: '',
          plan: (data.plan as User['plan']) || 'free',
          tripsThisMonth: data.tripsThisMonth ?? 0,
          maxTrips: data.maxTrips ?? 10,
          resetDate: data.resetDate || '',
          name: data.name || username || '',
          email: data.email || email || ''
        };

        saveUserCache(user);

        this.user = user;
        this.isLoading = false;
        this.error = null;

        if (user.id) await trips.syncFromCloud(user.id);
      } else {
        const cachedUser = getUserCache();
        if (cachedUser && username) {
          console.log('✅ Restored user session from offline cache');
          this.user = cachedUser;
          this.isLoading = false;
          this.error = null;
          await trips.load(cachedUser.id || cachedUser.name || 'user');
        } else {
          this.user = null;
          this.isLoading = false;
          this.error = null;
        }
      }
    } catch (error) {
      console.warn('Failed to verify session, checking offline cache...', error);
      const cachedUser = getUserCache();
      if (cachedUser && username) {
        console.log('✅ Restored user session from offline cache');
        this.user = cachedUser;
        this.isLoading = false;
        this.error = null;
        if (cachedUser.id) await trips.load(cachedUser.id);
      } else {
        this.user = null;
        this.isLoading = false;
        this.error = null;
      }
    }
  }

  updateProfile(data: { name?: string; email?: string }) {
    if (!this.user) return;
    const updatedUser = { ...this.user, ...data };
    saveUserCache(updatedUser);
    this.user = updatedUser;
  }

  async signup(username: string, password: string) {
    this.isLoading = true;
    this.error = null;
    try {
      const response = (await api.signup(username, password)) as AuthResponse;
      const offlineId = (() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('offline_user_id');
      })();

      storage.setUsername(username);

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

      let subscription = { plan: 'free', tripsThisMonth: 0, maxTrips: 10, resetDate: '' };
      try {
        subscription = await api.getSubscription();
      } catch (e) {
        console.warn('Subscription lookup failed during signup', e);
      }

      if (!response || !response.id) {
        console.warn('Signup response missing user id; signup incomplete');
        this.user = null;
        this.isLoading = false;
        this.error = 'Signup failed';
        return { success: false, error: 'Signup failed' } as const;
      }

      const user: User = {
        id: String(response.id),
        token: '',
        plan: (subscription.plan as User['plan']) || 'free',
        tripsThisMonth: subscription.tripsThisMonth,
        maxTrips: subscription.maxTrips,
        resetDate: subscription.resetDate,
        name: username,
        email: ''
      };

      this.user = user;
      this.isLoading = false;
      this.error = null;

      if (offlineId) {
        await trips.migrateOfflineTrips(offlineId, user.id || username);
        localStorage.removeItem('offline_user_id');
      }

      await trips.syncFromCloud(user.id || username);

      return { success: true, resetKey: response.resetKey } as const;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.error = message || 'Signup failed';
      return { success: false, error: message } as const;
    }
  }

  async login(username: string, password: string) {
    this.isLoading = true;
    this.error = null;
    try {
      const response = (await api.login(username, password)) as AuthResponse;
      const offlineId = (() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem('offline_user_id');
      })();

      storage.setUsername(username);

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

      const savedEmail =
        typeof window !== 'undefined' ? sessionStorage.getItem('user_email') || '' : '';
      let subscription = { plan: 'free', tripsThisMonth: 0, maxTrips: 10, resetDate: '' };
      try {
        subscription = await api.getSubscription();
      } catch (e) {
        console.warn('Subscription lookup failed during login', e);
      }

      if (!response || !response.id) {
        console.warn('Login response missing user id; login incomplete');
        this.user = null;
        this.isLoading = false;
        this.error = 'Login failed';
        return { success: false, error: 'Login failed' } as const;
      }

      const user: User = {
        id: String(response.id),
        token: '',
        plan: (subscription.plan as User['plan']) || 'free',
        tripsThisMonth: subscription.tripsThisMonth,
        maxTrips: subscription.maxTrips,
        resetDate: subscription.resetDate,
        name: username,
        email: savedEmail
      };

      saveUserCache(user);

      this.user = user;
      this.isLoading = false;
      this.error = null;

      if (offlineId) {
        await trips.migrateOfflineTrips(offlineId, user.id || username);
        localStorage.removeItem('offline_user_id');
      }

      await trips.syncFromCloud(user.id || username);

      return { success: true } as const;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.error = message || 'Login failed';
      return { success: false, error: message } as const;
    }
  }

  async logout() {
    try {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      console.warn('Failed to clear server session:', e);
    }

    storage.clearUsername();
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_email');
      sessionStorage.removeItem('user_cache');
    }

    this.user = null;
    this.isLoading = false;
    this.error = null;
  }

  async changePassword(username: string, currentPassword: string, newPassword: string) {
    this.isLoading = true;
    this.error = null;
    try {
      await api.changePassword(username, currentPassword, newPassword);
      this.isLoading = false;
      this.error = null;
      return { success: true } as const;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.error = message || 'Password change failed';
      return { success: false, error: message } as const;
    }
  }

  async resetPassword(username: string, resetKey: string, newPassword: string) {
    this.isLoading = true;
    this.error = null;
    try {
      await api.resetPassword(username, resetKey, newPassword);
      this.isLoading = false;
      this.error = null;
      return { success: true } as const;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.error = message || 'Password reset failed';
      return { success: false, error: message } as const;
    }
  }

  async deleteAccount(username: string, password: string) {
    this.isLoading = true;
    this.error = null;
    try {
      const response = await csrfFetch('/api/user', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const dataRaw = await response.json().catch(() => ({}) as Record<string, unknown>);
        const data = dataRaw as Record<string, unknown>;
        const errMsg =
          typeof data['error'] === 'string' ? (data['error'] as string) : 'Account deletion failed';
        throw new Error(errMsg);
      }

      storage.clearAll();
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('user_email');
        sessionStorage.removeItem('user_cache');
      }
      trips.clear();

      this.user = null;
      this.isLoading = false;
      this.error = null;

      return { success: true } as const;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.isLoading = false;
      this.error = message || 'Account deletion failed';
      return { success: false, error: message } as const;
    }
  }

  async refreshSubscription() {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) return;

      const data = (await response.json()) as { user?: Partial<User> };
      if (!data.user) return;

      if (!this.user) return;
      const updated: User = {
        ...this.user,
        id: typeof data.user?.id === 'string' ? String(data.user.id) : (this.user.id ?? ''),
        plan: data.user?.plan || this.user.plan,
        tripsThisMonth: data.user?.tripsThisMonth ?? this.user.tripsThisMonth,
        maxTrips: data.user?.maxTrips ?? this.user.maxTrips,
        resetDate: data.user?.resetDate || this.user.resetDate
      };
      saveUserCache(updated);
      this.user = updated;
    } catch (error) {
      console.error('Failed to refresh subscription:', error);
    }
  }

  clearError() {
    this.error = null;
  }

  getSnapshot() {
    return {
      user: this.user,
      isAuthenticated: this.isAuthenticated,
      isLoading: this.isLoading,
      error: this.error
    };
  }
}

export type AuthSnapshot = ReturnType<AuthState['getSnapshot']>;
export const auth = new AuthState() as AuthState & {
  subscribe: (run: (v: AuthSnapshot) => void) => () => void;
};

// Attach subscribe for backwards-compatibility so `$auth` in components is typed
auth.subscribe = (run: (v: AuthSnapshot) => void) => {
  run(auth.getSnapshot());
  $effect(() => run(auth.getSnapshot()));
  return () => {};
};

// --- Compatibility stores for existing consumers (we keep svelte/store usage inside this store module) ---
export const user = createCompatibilityStore<User | null>(
  () => auth.user,
  (set) => {
    $effect(() => set(auth.user));
  }
);

export const isAuthenticated = createCompatibilityStore<boolean>(
  () => auth.isAuthenticated,
  (set) => {
    $effect(() => set(auth.isAuthenticated));
  }
);

export const isLoading = createCompatibilityStore<boolean>(
  () => auth.isLoading,
  (set) => {
    $effect(() => set(auth.isLoading));
  }
);

export const authError = createCompatibilityStore<string | null>(
  () => auth.error,
  (set) => {
    $effect(() => set(auth.error));
  }
);

export const canCreateTrip = createCompatibilityStore<boolean>(
  () => {
    const u = auth.user;
    if (!u) return true;
    if (u.plan === 'pro' || u.plan === 'business') return true;
    return (u.tripsThisMonth ?? 0) < (u.maxTrips ?? Infinity);
  },
  (set) => {
    $effect(() => {
      const u = auth.user;
      const val = (() => {
        if (!u) return true;
        if (u.plan === 'pro' || u.plan === 'business') return true;
        return (u.tripsThisMonth ?? 0) < (u.maxTrips ?? Infinity);
      })();
      set(val);
    });
  }
);
