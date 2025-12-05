import { writable } from 'svelte/store';

export const currentUser = writable(null);

export function setUser(user: any) {
    currentUser.set(user);
}
