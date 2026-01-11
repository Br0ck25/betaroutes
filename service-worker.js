const CACHE_NAME = 'route-calculator-cache-v2.2.0'; // Stripe integration + enhanced analytics
const urlsToCache = [
	'/index.html',
	'/dashboard.html',
	'/offline.html',
	'/logo.png',
	'/logo512.png',
	'/app.js',
	'/subscription-integration.js', // NEW: Subscription features
	'/dashboard.js', // NEW: Dashboard logic
	'/dashboard-enhanced.js', // NEW: Enhanced analytics
	'/styles.css',
	'/dashboard.css'
];

// Install: Cache app shell
self.addEventListener('install', (event) => {
	self.skipWaiting();
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			console.log('✓ Caching app shell v2.2.0 (Stripe + Analytics)');
			return cache.addAll(urlsToCache);
		})
	);
});

// Activate: Remove old caches and reload clients
self.addEventListener('activate', (event) => {
	self.clients.claim();
	event.waitUntil(
		caches
			.keys()
			.then((cacheNames) =>
				Promise.all(
					cacheNames.map((cache) => {
						if (cache !== CACHE_NAME) {
							console.log('✓ Deleting old cache:', cache);
							return caches.delete(cache);
						}
					})
				)
			)
			.then(() =>
				self.clients.matchAll().then((clients) => {
					clients.forEach((client) => client.navigate(client.url));
				})
			)
	);
});

// Fetch: Network-first for HTML, cache-first for assets
self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);

	// Handle navigation requests (HTML pages)
	if (
		event.request.mode === 'navigate' ||
		url.pathname === '/' ||
		url.pathname === '/index.html' ||
		url.pathname === '/dashboard.html'
	) {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					// Cache the response for offline access
					const responseClone = response.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, responseClone);
					});
					return response;
				})
				.catch(async () => {
					// Try to serve from cache
					const cached = await caches.match(event.request);
					if (cached) return cached;

					// Try index.html or dashboard.html as fallbacks
					if (url.pathname.includes('dashboard')) {
						const dashCached = await caches.match('/dashboard.html');
						if (dashCached) return dashCached;
					}

					const indexCached = await caches.match('/index.html');
					if (indexCached) return indexCached;

					// Final fallback: offline page
					return await caches.match('/offline.html');
				})
		);
		return;
	}

	// Ignore non-GET requests
	if (event.request.method !== 'GET') return;

	// Cache-first strategy for static assets
	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) return cachedResponse;

			return fetch(event.request)
				.then((networkResponse) => {
					const cloned = networkResponse.clone();
					const isSameOrigin = url.origin === self.location.origin;
					const isHTML = url.pathname.endsWith('.html');

					// Cache non-HTML static assets
					if (
						!isHTML &&
						(url.href.startsWith('https://cdnjs.cloudflare.com') ||
							url.href.startsWith('https://cdn.jsdelivr.net') ||
							isSameOrigin)
					) {
						caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
					}

					return networkResponse;
				})
				.catch(() => {
					// For document requests, show offline page
					if (event.request.destination === 'document') {
						return caches.match('/offline.html');
					}
					// For other assets, return empty response
					return new Response('', {
						status: 200,
						statusText: 'Fallback empty response',
						headers: { 'Content-Type': 'text/plain' }
					});
				});
		})
	);
});

// Handle messages from clients
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

// Background sync for failed requests (future enhancement)
self.addEventListener('sync', (event) => {
	if (event.tag === 'sync-logs') {
		event.waitUntil(syncPendingLogs());
	}
});

async function syncPendingLogs() {
	// This will be called when the device comes back online
	console.log('⚡ Background sync triggered: syncing pending logs');
	// Actual sync logic would be handled by app.js
}
