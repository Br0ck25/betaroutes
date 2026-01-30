import { writable } from 'svelte/store';
import type { User } from '$lib/server/userService';

export const currentUser = writable<User | null>(null);

export function setUser(user: User | null) {
  currentUser.set(user);
}
