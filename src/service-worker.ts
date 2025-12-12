/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
  ...build, // the app itself
  ...files  // everything in static
];

self.addEventListener('install', (event) => {
  // Create a new cache and add all files to it
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  }

  event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
  // Remove previous cached data from disk
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
  }

  event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
  // ignore POST requests etc
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // [!code ++] CRITICAL FIX: Exclude API requests from Service Worker caching.
  // This prevents conflicts with the app's internal IndexedDB sync logic.
  if (url.pathname.startsWith('/api')) return;

  async function respond() {
    const cache = await caches.open(CACHE);

    // Serve build assets from cache
    if (ASSETS.includes(url.pathname)) {
      const response = await cache.match(url.pathname);
      if (response) return response;
    }

    // For everything else, try the network first, but fall back to cache if offline
    try {
      const response = await fetch(event.request);

      // if we're offline, fetch can return a value that is not a Response
      // instead of throwing - and we can't consume this- but if it's 200, cache it
      if (response.status === 200) {
        cache.put(event.request, response.clone());
      }

      return response;
    } catch {
      // fall back to cache
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      throw new Error('Offline and resource not found in cache');
    }
  }

  event.respondWith(respond());
});