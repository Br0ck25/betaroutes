import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRenderableCandidate } from './autocomplete';
import { geocode as geocodeServer } from '../../lib/server/geocode';

describe('autocomplete validator', () => {
	it('rejects broad/place-level results for address-like input', () => {
		const input = '407 Mastin Dr, Cumberland, KY 40823';
		const bad = { name: '407', osm_value: 'place' };
		expect(isRenderableCandidate(bad, input)).toBe(false);
	});

	it('accepts address-level result with housenumber and street', () => {
		const input = '407 Mastin Dr, Cumberland, KY 40823';
		const good = {
			name: '407 Mastin Dr',
			house_number: '407',
			street: 'Mastin Dr',
			formatted_address: '407 Mastin Dr, Cumberland, KY'
		};
		expect(isRenderableCandidate(good, input)).toBe(true);
	});

	it('rejects street-only result for address-like input (force Google)', () => {
		const input = '1199 Main St Jackson KY';
		const poi = {
			name: 'Sonic',
			street: 'Main St',
			formatted_address: 'Sonic, Munfordville, KY'
		};
		expect(isRenderableCandidate(poi, input)).toBe(false);
	});

	it('rejects result with mismatched house number', () => {
		const input = '1199 Main St Jackson KY';
		const poi = {
			name: 'Sonic',
			house_number: '100',
			street: 'Main St'
		};
		expect(isRenderableCandidate(poi, input)).toBe(false);
	});
});

describe('server geocode (Google-only)', () => {
	beforeEach(() => {
		// ensure fetch is clean
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns null when no API key provided', async () => {
		const address = '407 Mastin Dr, Cumberland, KY 40823';
		const res = await geocodeServer(address);
		expect(res).toBeNull();
	});

	it('calls Google and returns coords when API key provided', async () => {
		const address = '407 Mastin Dr, Cumberland, KY 40823';
		vi.stubGlobal('fetch', (input: any) => {
			const url = String(input);
			if (url.includes('maps.googleapis.com')) {
				return Promise.resolve({
					json: async () => ({
						status: 'OK',
						results: [{ geometry: { location: { lat: 36.9, lng: -83.3 } } }]
					})
				} as any);
			}
			return Promise.reject(new Error('unexpected'));
		});

		const res = await geocodeServer(address, 'FAKE_KEY');
		expect(res).toEqual({ lat: 36.9, lon: -83.3, formattedAddress: undefined });
	});

	it('returns google coords for a second address example', async () => {
		const address = '1199 Main St Jackson KY';
		vi.stubGlobal('fetch', (input: any) => {
			const url = String(input);
			if (url.includes('maps.googleapis.com')) {
				return Promise.resolve({
					json: async () => ({
						status: 'OK',
						results: [{ geometry: { location: { lat: 36.9, lng: -83.3 } } }]
					})
				} as any);
			}
			return Promise.reject(new Error('unexpected'));
		});

		const res = await geocodeServer(address, 'FAKE_KEY');
		expect(res).toEqual({ lat: 36.9, lon: -83.3, formattedAddress: undefined });
	});
});
