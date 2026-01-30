// src/service-worker.ts
/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

// Declare self as ServiceWorkerGlobalScope
declare const self: ServiceWorkerGlobalScope;

// Emergency kill switch - set to true and deploy to unregister all service workers
const KILL_SWITCH = false;

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
  ...build, // the app itself
  ...files // everything in `static`
];

// Kill switch: immediately unregister and clean up
if (KILL_SWITCH) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          if ('navigate' in client) {
            client.navigate(client.url);
          }
        });
      })()
    );
  });
} else {
  // Normal service worker operation
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
              `service-worker: failed to fetch ${asset}: ${res?.status} ${res?.statusText}`
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

    const url = new URL(event.request.url);

    // SECURITY: Never cache API responses (may contain user data)
    // Also exclude auth-related routes and external URLs
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/login') ||
      url.pathname.startsWith('/register') ||
      url.pathname.startsWith('/logout') ||
      url.pathname.startsWith('/reset-password') ||
      url.pathname.startsWith('/forgot-password') ||
      url.origin !== self.location.origin
    ) {
      return; // Let the browser handle these requests without service worker interference
    }

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

            // If we have a cached page, return it
            if (cached) return cached;

            // Fallback: return a minimal offline page
            return new Response(
              `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Offline - GoRoute</title>
	<style>
		body {
			font-family: system-ui, -apple-system, sans-serif;
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 100vh;
			margin: 0;
			padding: 2rem;
			background: #F5F5F5;
		}
		.container {
			text-align: center;
			max-width: 400px;
		}
		h1 {
			color: #F68A2E;
			font-size: 1.5rem;
			margin-bottom: 1rem;
		}
		p {
			color: #333333;
			line-height: 1.6;
		}
		button {
			margin-top: 1rem;
			padding: 0.75rem 1.5rem;
			background: #F68A2E;
			color: white;
			border: none;
			border-radius: 0.5rem;
			font-size: 1rem;
			cursor: pointer;
		}
		button:hover {
			background: #e07a26;
		}
	</style>
</head>
<body>
	<div class="container">
		<h1>📡 You're Offline</h1>
		<p>No internet connection detected. Please check your connection and try again.</p>
		<button onclick="window.location.reload()">Retry</button>
	</div>
</body>
</html>
							`,
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/html' }
              }
            );
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

  // Background sync for failed requests (future enhancement)
  // ExtendableEvent with tag property for sync events
  self.addEventListener('sync', (event: ExtendableEvent & { tag: string }) => {
    if (event.tag === 'sync-logs') {
      event.waitUntil(syncPendingLogs());
    }
  });

  async function syncPendingLogs() {
    // This will be called when the device comes back online
    console.log('⚡ Background sync triggered: syncing pending logs');
    // Logic to replay failed requests would go here (e.g. reading from IndexedDB)
  }
}
