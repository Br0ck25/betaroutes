// src/lib/stores/userSettings.ts
import { writable } from 'svelte/store';
import { storage } from '$lib/utils/storage';
import { browser } from '$app/environment';

// Align defaults with API schema
const defaultSettings = {
  startLocation: '',
  endLocation: '',
  defaultMPG: 25,
  defaultGasPrice: 3.50,
  distanceUnit: 'mi',
  timeFormat: '12h'
};

// 1. Start with defaults (Server matches Client initially)
export const userSettings = writable(defaultSettings);

// 2. Hydrate from Storage ONLY in the browser
if (browser) {
    try {
        const saved = storage.getSettings(); // This now returns partial object
        // Merge defaults with saved to ensure integrity
        userSettings.set({ ...defaultSettings, ...saved });

        // 3. Auto-save changes
        userSettings.subscribe((value) => {
            storage.saveSettings(value);
        });
    } catch (e) {
        console.error('Failed to hydrate settings', e);
    }
}