import type { User } from '$lib/types';
import { getContext, setContext } from 'svelte';

const USER_KEY = Symbol('USER');

export class UserState {
  // Rune for reactive state — typed to User or null
  value = $state<User | null>(null);

  constructor(initialUser?: User | null) {
    this.value = initialUser ?? null;
  }

  // Actions
  setUser(u: User | null) {
    this.value = u;
  }

  logout() {
    this.value = null;
  }
}

// Helper to set context in root layout
export function setUserContext(initialUser?: User | null) {
  const userState = new UserState(initialUser ?? null);
  setContext(USER_KEY, userState);
  return userState;
}

// Helper to get context in components
export function getUserState() {
  return getContext<UserState>(USER_KEY);
}
