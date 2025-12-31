/* @vitest-environment jsdom */
import { it, expect, vi } from 'vitest';

it('on blur escalates to Google and replaces input if suggestions are unacceptable', async () => {
	// Use fake timers to drive the blur timeout
	vi.useFakeTimers();
	const input = document.createElement('input');
	input.type = 'text';
	const { autocomplete } = await import('./autocomplete');
	autocomplete(input, { apiKey: 'undefined' } as any);

	input.value = '407 Mastin Dr, Cumberland, KY';

	vi.stubGlobal('fetch', (inputArg: any) => {
		const url = String(inputArg);
		if (url.includes('/api/autocomplete')) {
			return Promise.resolve({
				json: async () => [
					{
						source: 'google_proxy',
						formatted_address: '407 Mastin Dr, Cumberland, KY',
						geometry: { location: { lat: 36.9, lng: -83.3 } },
						place_id: 'g1'
					}
				]
			} as any);
		}
		return Promise.reject(new Error('unexpected'));
	});

	// Trigger blur which runs setTimeout(..., 200)
	input.dispatchEvent(new Event('blur'));
	// advance timers to pass blur delay
	vi.advanceTimersByTime(300);
	// Allow promises to resolve
	await Promise.resolve();

	expect(input.value).toBe('407 Mastin Dr, Cumberland, KY');

	// cleanup
	vi.useRealTimers();
	vi.restoreAllMocks();
});
