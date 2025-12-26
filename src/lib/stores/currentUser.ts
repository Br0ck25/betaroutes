import { writable } from 'svelte/store';

export const currentUser = writable<any | null>(null);

export function setUser(user: any) {
    currentUser.set(user);
}
