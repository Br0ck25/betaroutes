import { getContext, setContext } from 'svelte';

const USER_KEY = Symbol('USER');

export class UserState {
  // Rune for reactive state
  value = $state<any>(null);

  constructor(initialUser: any) {
    this.value = initialUser;
  }

  // Actions
  setUser(u: any) {
    this.value = u;
  }

  logout() {
    this.value = null;
  }
}

// Helper to set context in root layout
export function setUserContext(initialUser: any) {
  const userState = new UserState(initialUser);
  setContext(USER_KEY, userState);
  return userState;
}

// Helper to get context in components
export function getUserState() {
  return getContext<UserState>(USER_KEY);
}
