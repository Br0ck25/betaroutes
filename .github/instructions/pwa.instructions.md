---
description: 'Progressive Web App (PWA) rules'
applyTo: 'src/service-worker.ts,**/*.svelte,**/*.ts'
---

# Progressive Web App (PWA) Security Rules

## Service Worker Caching (CRITICAL)

### NEVER cache protected data
- NEVER cache `/api/**` routes
- NEVER cache responses with `Set-Cookie` header
- NEVER cache user-specific responses
- NEVER cache authenticated HTML pages

### Only cache public assets
- ✅ App shell (HTML, CSS, JS bundles)
- ✅ Static assets (fonts, icons, images)
- ✅ Public content (marketing pages, docs)

### Implementation example
```typescript
// src/service-worker.ts
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Never cache API routes
  if (url.pathname.startsWith('/api')) {
    return; // Network only
  }
  
  // Never cache if response has Set-Cookie
  async function respond() {
    const response = await fetch(event.request);
    
    const isPrivate = 
      response.headers.has('Set-Cookie') ||
      response.headers.get('Cache-Control')?.includes('no-store');
    
    if (response.status === 200 && !isPrivate) {
      // Safe to cache
      cache.put(event.request, response.clone());
    }
    
    return response;
  }
  
  event.respondWith(respond());
});
```

## Cache-Control Headers (Server-Side)

### Protected routes
```typescript
// API routes - never cache
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401);
  
  return json(data, {
    headers: {
      'Cache-Control': 'no-store',
      'Vary': 'Cookie'
    }
  });
};

// Authenticated HTML - never cache
export const load: PageServerLoad = async ({ locals }) => {
  return {
    // Data
  };
};
// In hooks.server.ts, set Cache-Control: no-store for authenticated HTML
```

### Public routes
```typescript
// Public API - short cache
export const GET: RequestHandler = async () => {
  return json(publicData, {
    headers: {
      'Cache-Control': 'public, max-age=300' // 5 minutes
    }
  });
};
```

## Offline Data (IndexedDB)

### Use IndexedDB for offline queues
- Store pending mutations (create/update/delete) in IndexedDB
- NEVER store sensitive data in service worker cache
- Sync to server when online

### User isolation
```typescript
// Queue must include userId for isolation
interface QueueItem {
  id: string;
  userId: string; // REQUIRED for isolation
  action: 'create' | 'update' | 'delete';
  data: unknown;
  timestamp: number;
}

// Add to queue
await syncManager.addToQueue({
  action: 'create',
  data: trip
}, userId); // MUST pass userId
```

### Clear on logout
```typescript
// Logout handler
async function logout(userId: string) {
  // Clear sync queue
  await clearUserData(userId);
  
  // Clear session
  await fetch('/api/auth/logout', { method: 'POST' });
  
  // Redirect
  goto('/login');
}
```

## Sync Queue Isolation (CRITICAL)

### Every queue item needs userId
- `syncManager.addToQueue()` MUST receive `userId` parameter
- Queue items MUST be scoped to user
- Prevents cross-user data contamination

### Implementation
```typescript
// ✅ CORRECT
class SyncManager {
  async addToQueue(
    item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'userId'>,
    userId: string // REQUIRED
  ) {
    const queueItem: SyncQueueItem = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId // Store with item
    };
    
    await db.syncQueue.add(queueItem);
  }
  
  async clearUserQueue(userId: string) {
    // Only clear this user's items
    await db.syncQueue
      .where('userId')
      .equals(userId)
      .delete();
  }
}

// ❌ WRONG
class SyncManager {
  async addToQueue(item: SyncQueueItem) {
    // Missing userId parameter
    await db.syncQueue.add(item);
  }
}
```

## Manifest.json

### Required fields
- `name`, `short_name`
- `start_url: "."` (base-path aware)
- `scope: "."` (base-path aware)
- `display: "standalone"`
- `background_color`, `theme_color` (match DESIGN_SYSTEM.md)
- `icons` (include maskable icon)

### Security considerations
- Use relative URLs (works with subpath deployments)
- Include proper `id` for app identity
- Set appropriate `orientation` if needed

## Progressive Enhancement

### Feature detection
```typescript
// Check for service worker support
if ('serviceWorker' in navigator) {
  await navigator.serviceWorker.register('/service-worker.js');
}

// Check for background sync
if ('sync' in window.registration) {
  await registration.sync.register('sync-trips');
}

// Fallback gracefully
if (!('serviceWorker' in navigator)) {
  console.log('PWA features not available');
  // App still works, just no offline support
}
```

### No user-agent sniffing
- Use feature detection, not UA parsing
- Test for capabilities: `'serviceWorker' in navigator`
- Provide graceful fallbacks

## Update Strategy

### Safe updates
- Show "Update available" prompt
- Don't force reload during active use
- Let user choose when to update

### Implementation
```typescript
// In app layout
let updateAvailable = $state(false);

$effect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      registration.addEventListener('updatefound', () => {
        updateAvailable = true;
      });
    });
  }
});
```

## Kill Switch

### Emergency service worker uninstall
```typescript
// Emergency SW - deploy if needed
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        if (client instanceof WindowClient) {
          client.navigate(client.url);
        }
      });
    })()
  );
});
```

## Testing

### PWA audit checklist
- [ ] Lighthouse PWA score = 100
- [ ] Works offline (app shell loads)
- [ ] Installable (A2HS prompt appears)
- [ ] No API routes cached in SW
- [ ] Logout clears IndexedDB
- [ ] Sync queue isolated by userId
