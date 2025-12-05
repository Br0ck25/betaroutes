// src/lib/stores/userSettings.ts
import { writable } from 'svelte/store';
import { storage } from '$lib/utils/storage';

const defaultSettings = {
  startLocation: '',
  endLocation: '',
  defaultMPG: 25,
  defaultGasPrice: 3.50,
  distanceUnit: 'mi',
  timeFormat: '12h'
};

const saved = storage.get('user-settings');

export const userSettings = writable(saved || defaultSettings);

userSettings.subscribe((value) => {
  storage.set('user-settings', value);
});
