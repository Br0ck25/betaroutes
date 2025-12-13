/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  }
  event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
  }
  event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
  // 1. Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 2. [CRITICAL] Ignore API calls (let the app handle sync)
  if (url.pathname.startsWith('/api')) return;

  // 3. [CRITICAL FIX] Ignore external domains (Cloudflare, Google Maps, etc.)
  // This prevents "FetchEvent resulted in a network error"
  if (url.origin !== self.location.origin) return;

  async function respond() {
    const cache = await caches.open(CACHE);

    if (ASSETS.includes(url.pathname)) {
      const response = await cache.match(url.pathname);
      if (response) return response;
    }

    try {
      const response = await fetch(event.request);
      if (response.status === 200) {
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) return cachedResponse;
      throw new Error('Offline and resource not found in cache');
    }
  }

  event.respondWith(respond());
});