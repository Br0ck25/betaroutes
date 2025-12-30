import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRenderableCandidate } from './autocomplete';
import { geocodePhoton as geocodePhotonOptimize } from '../../routes/api/directions/optimize/+server';

describe('autocomplete validator', () => {
	it('rejects broad/place-level Photon results for address-like input', () => {
		const input = '407 Mastin Dr, Cumberland, KY 40823';
		const bad = { name: '407', osm_value: 'place' };
		expect(isRenderableCandidate(bad, input)).toBe(false);
	});

	it('accepts Photon address-level result with housenumber and street', () => {
		const input = '407 Mastin Dr, Cumberland, KY 40823';
		const good = {
			name: '407 Mastin Dr',
			house_number: '407',
			street: 'Mastin Dr',
			formatted_address: '407 Mastin Dr, Cumberland, KY',
			source: 'photon'
		};
		expect(isRenderableCandidate(good, input)).toBe(true);
	});

	it('rejects street-only Photon result for address-like input (force Google)', () => {
		const input = '1199 Main St Jackson KY';
		const poi = {
			name: 'Sonic',
			street: 'Main St',
			formatted_address: 'Sonic, Munfordville, KY',
			source: 'photon'
		};
		expect(isRenderableCandidate(poi, input)).toBe(false);
	});

	it('rejects Photon result with mismatched house number', () => {
		const input = '1199 Main St Jackson KY';
		const poi = {
			name: 'Sonic',
			house_number: '100',
			street: 'Main St',
			source: 'photon'
		};
		expect(isRenderableCandidate(poi, input)).toBe(false);
	});
});

describe('server geocodePhoton fallback', () => {
	beforeEach(() => {
		// ensure fetch is clean
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns null when Photon result lacks housenumber and no API key provided', async () => {
		const address = '407 Mastin Dr, Cumberland, KY 40823';
		vi.stubGlobal('fetch', (input: any) => {
			const url = String(input);
			if (url.includes('photon.komoot.io')) {
				return Promise.resolve({ json: async () => ({ features: [{ geometry: { coordinates: [ -83.0, 36.6 ] }, properties: { name: 'Louisville', osm_value: 'city' } }] }) } as any);
			}
			return Promise.reject(new Error('unexpected'));
		});

		const res = await geocodePhotonOptimize(address);
		expect(res).toBeNull();
	});

	it('falls back to Google geocode when Photon result is weak and API key provided', async () => {
		const address = '407 Mastin Dr, Cumberland, KY 40823';
		vi.stubGlobal('fetch', (input: any) => {
			const url = String(input);
			if (url.includes('photon.komoot.io')) {
				return Promise.resolve({ json: async () => ({ features: [{ geometry: { coordinates: [ -83.0, 36.6 ] }, properties: { name: 'Louisville', osm_value: 'city' } }] }) } as any);
			}
			if (url.includes('maps.googleapis.com')) {
				return Promise.resolve({ json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 36.9, lng: -83.3 } } }] }) } as any);
			}
			return Promise.reject(new Error('unexpected'));
		});

		const res = await geocodePhotonOptimize(address, 'FAKE_KEY');
		expect(res).toEqual([-83.3, 36.9]);
	});

	it('falls back to Google when Photon returns a mismatched house-number', async () => {
		const address = '1199 Main St Jackson KY';
		vi.stubGlobal('fetch', (input: any) => {
			const url = String(input);
			if (url.includes('photon.komoot.io')) {
				return Promise.resolve({ json: async () => ({ features: [{ geometry: { coordinates: [ -83.0, 36.6 ] }, properties: { name: 'Sonic', street: 'Main St', housenumber: '100' } }] }) } as any);
			}
			if (url.includes('maps.googleapis.com')) {
				return Promise.resolve({ json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 36.9, lng: -83.3 } } }] }) } as any);
			}
			return Promise.reject(new Error('unexpected'));
		});

		const res = await geocodePhotonOptimize(address, 'FAKE_KEY');
		expect(res).toEqual([-83.3, 36.9]);
	});
});
