// src/lib/services/googleMaps.ts
import { writable } from 'svelte/store';

class GoogleMapsLoader {
	private static instance: GoogleMapsLoader;
	private loadPromise: Promise<void> | null = null;
	public isLoaded = writable(false);

	private constructor() {}

	static getInstance() {
		if (!GoogleMapsLoader.instance) {
			GoogleMapsLoader.instance = new GoogleMapsLoader();
		}
		return GoogleMapsLoader.instance;
	}

	/**
	 * Idempotent load function.
	 * Call this from anywhere (SyncManager, Components) to ensure Maps is ready.
	 */
	load(apiKey: string): Promise<void> {
		if (typeof window === 'undefined') return Promise.resolve(); // SSR safety

		// 1. Check if already loaded globally
		if (window.google?.maps?.places) {
			this.isLoaded.set(true);
			return Promise.resolve();
		}

		// 2. Return existing promise if loading is in progress
		if (this.loadPromise) return this.loadPromise;

		// 3. Start loading
		this.loadPromise = new Promise((resolve, reject) => {
			// Double check inside promise in case of race
			if (window.google?.maps?.places) {
				this.isLoaded.set(true);
				resolve();
				return;
			}

			const script = document.createElement('script');
			// Use Google's recommended loading pattern to avoid the "loaded directly without loading=async" warning
			script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
			script.async = true;
			script.defer = true;

			script.onload = () => {
				this.isLoaded.set(true);
				resolve();
			};

			script.onerror = (err) => {
				this.loadPromise = null;
				console.error('Failed to load Google Maps API', err);
				reject(err);
			};

			// Google signals auth failures by calling window.gm_authFailure(). Install a
			// temporary handler to reject our load promise with a helpful message.
			const originalGmAuth = (window as any).gm_authFailure;
			let authCalled = false;
			(window as any).gm_authFailure = () => {
				authCalled = true;
				this.loadPromise = null;
				const origin = location?.origin || 'unknown origin';
				const err = new Error(
					`Google Maps API authentication failed (ApiTargetBlockedMapError or similar). Check API key restrictions and referer for ${origin}. See https://developers.google.com/maps/documentation/javascript/error-messages#api-target-blocked-map-error`
				);
				console.error(err.message);
				reject(err);
				// Call original handler if present
				if (typeof originalGmAuth === 'function') originalGmAuth();
			};

			// Cleanup after load or failure
			const cleanup = () => {
				// restore original gm_authFailure handler
				if ((window as any).gm_authFailure === (window as any).gm_authFailure) {
					(window as any).gm_authFailure = originalGmAuth;
				}
				clearTimeout(timeout);
			};

			script.onload = () => {
				// If Google invoked gm_authFailure synchronously, prefer that error
				if (authCalled) return;
				this.isLoaded.set(true);
				cleanup();
				resolve();
			};

			// Safety timeout: if maps hasn't loaded after 10s, reject to avoid hanging
			const timeout = setTimeout(() => {
				this.loadPromise = null;
				const err = new Error('Timed out loading Google Maps API.');
				console.error(err);
				reject(err);
			}, 10000);

			document.head.appendChild(script);
		});

		return this.loadPromise;
	}
}

export const googleMaps = GoogleMapsLoader.getInstance();
