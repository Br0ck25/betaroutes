// src/service-worker.ts
/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
	...build, // the app itself
	...files // everything in `static`
];

self.addEventListener('install', (event) => {
	// Create a new cache and add all files to it
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);

		// Fast path: try adding everything at once. If any request fails, fall back to
		// fetching assets individually so we can skip/log failures and avoid the
		// whole installation failing.
		try {
			await cache.addAll(ASSETS);
			return;
		} catch (err) {
			// addAll failed (often because one asset returned a non-OK response).
			console.warn('service-worker: cache.addAll failed, retrying assets individually', err);
		}

		// Fetch and add assets individually, logging failures but continuing.
		for (const asset of ASSETS) {
			try {
				const res = await fetch(asset, { cache: 'no-cache' });
				if (!res || !res.ok) {
					console.warn(
						`service-worker: failed to fetch ${asset}: ${res && res.status} ${res && res.statusText}`
					);
					continue;
				}
				await cache.put(asset, res.clone());
			} catch (e) {
				console.warn(`service-worker: error fetching ${asset}`, e);
			}
		}
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	// Remove previous caches
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	// ignore non-GET requests
	if (event.request.method !== 'GET') return;

	// Handle navigation requests (HTML pages) with a network-first strategy
	if (event.request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const networkResponse = await fetch(event.request);
					if (networkResponse && networkResponse.status === 200) {
						const cache = await caches.open(CACHE);
						cache.put(event.request, networkResponse.clone());
					}
					return networkResponse;
				} catch (err) {
					const cache = await caches.open(CACHE);
					const cached = (await cache.match('/offline.html')) || (await cache.match('/'));
					if (cached) return cached;
					throw err;
				}
			})()
		);
		return;
	}

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		// Serve build assets from cache directly
		if (ASSETS.includes(url.pathname)) {
			const response = await cache.match(url.pathname);
			if (response) return response;
		}

		// For everything else, try the network first, then cache
		try {
			const response = await fetch(event.request);

			// if we're offline, fetch can return a value that is not a Response
			// instead of throwing - and we only want to cache valid responses
			if (!(response instanceof Response)) {
				throw new Error('invalid response from fetch');
			}

			if (response.status === 200) {
				cache.put(event.request, response.clone());
			}

			return response;
		} catch (err) {
			const response = await cache.match(event.request);
			if (response) return response;

			throw err;
		}
	}

	event.respondWith(respond());
});
