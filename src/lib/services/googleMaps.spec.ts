/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { googleMaps } from './googleMaps';

describe('GoogleMapsLoader auth failure handling', () => {
	it('rejects when gm_authFailure is called', async () => {
		// Ensure no global handler exists yet
		delete (window as any).gm_authFailure;

		const p = googleMaps.load('FAKE_KEY');

		// Simulate Google's auth failure callback
		if (typeof (window as any).gm_authFailure === 'function') {
			(window as any).gm_authFailure();
		}

		await expect(p).rejects.toThrow(/Google Maps API authentication failed/);
	});
});
