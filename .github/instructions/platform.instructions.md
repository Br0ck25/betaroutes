---
description: 'Cloudflare Workers/Pages platform rules'
applyTo: 'src/**/*.server.ts,src/routes/**/+server.ts,src/hooks.server.ts,src/worker-entry.ts'
---

# Cloudflare Platform Rules

## Environment Bindings (CRITICAL)

### Use platform.env for all secrets and bindings

- Access via `platform.env` in SvelteKit request handlers
- NEVER use `process.env` (Node.js only, doesn't work on edge)

### Example

```typescript
// ✅ CORRECT
export const GET: RequestHandler = async ({ platform }) => {
  const kv = platform?.env?.BETA_LOGS_KV;
  const apiKey = platform?.env?.PRIVATE_GOOGLE_MAPS_API_KEY;

  if (!kv) throw error(500, 'KV binding missing');

  // Use bindings...
};

// ❌ WRONG
export const GET: RequestHandler = async () => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY; // Doesn't work on edge!
};
```

### Type safety

```typescript
// src/app.d.ts
declare global {
  namespace App {
    interface Platform {
      env: {
        // KV Namespaces
        BETA_LOGS_KV: KVNamespace;
        BETA_USERS_KV: KVNamespace;
        // ... other bindings

        // Secrets
        PRIVATE_GOOGLE_MAPS_API_KEY: string;
        HNS_ENCRYPTION_KEY: string;

        // Durable Objects
        TRIP_INDEX_DO: DurableObjectNamespace;
      };
      context: {
        waitUntil(promise: Promise<unknown>): void;
      };
    }
  }
}
```

## Edge Runtime Compatibility

### No Node.js built-ins

```typescript
// ❌ FORBIDDEN
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import crypto from 'crypto';

// ✅ USE WEB APIS
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hash = await crypto.subtle.digest('SHA-256', data);
```

### Available Web APIs

- `fetch` (native, no need to import)
- `crypto` (Web Crypto API)
- `URL`, `URLSearchParams`
- `TextEncoder`, `TextDecoder`
- `ReadableStream`, `WritableStream`
- `Headers`, `Request`, `Response`

### No synchronous I/O

```typescript
// ❌ WRONG - synchronous
const data = fs.readFileSync('file.txt');

// ✅ CORRECT - async
const data = await kv.get('key');
```

## KV (Key-Value) Storage

### Composite key pattern (CRITICAL)

- ALWAYS scope keys to user: `{resource}:${userId}:${id}`
- NEVER use global prefixes: `trips:${id}` is FORBIDDEN

```typescript
// ✅ CORRECT - user-scoped
const userId = locals.user.id; // From session
const key = `trip:${userId}:${tripId}`;
await kv.put(key, JSON.stringify(trip));

// List user's trips only
const list = await kv.list({ prefix: `trip:${userId}:` });

// ❌ WRONG - global prefix
const key = `trips:${tripId}`;
await kv.list({ prefix: 'trips:' }); // Returns ALL users' trips!
```

### KV operations

```typescript
// Get value
const value = await kv.get(key);
const json = await kv.get(key, { type: 'json' });

// Put value
await kv.put(key, value);
await kv.put(key, JSON.stringify(data));

// Delete value
await kv.delete(key);

// List keys
const list = await kv.list({ prefix: 'trip:user123:' });
for (const key of list.keys) {
  console.log(key.name);
}
```

### KV limitations

- Keys: max 512 bytes
- Values: max 25 MB
- Eventually consistent (writes take up to 60s to propagate globally)
- No transactions (use Durable Objects for consistency)

## Durable Objects

### When to use

- Need strong consistency
- Need coordination between requests
- Need WebSocket connections
- Need stateful computation

### Access pattern

```typescript
// Get DO binding
const namespace = platform?.env?.TRIP_INDEX_DO;
if (!namespace) throw error(500, 'DO binding missing');

// Create ID from name (deterministic)
const id = namespace.idFromName(`user:${userId}`);

// Get stub
const stub = namespace.get(id);

// Call DO
const response = await stub.fetch(request);
```

### DO class structure

```typescript
// src/lib/server/TripIndexDO.ts
export class TripIndexDO {
  state: DurableObjectState;
  env: Record<string, unknown>;

  constructor(state: DurableObjectState, env: Record<string, unknown>) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/add') {
      // Add to index...
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }
}
```

## ExecutionContext

### Background tasks

```typescript
export const POST: RequestHandler = async ({ request, platform }) => {
  // Quick response
  const response = json({ success: true });

  // Background task (don't await)
  platform?.context.waitUntil(expensiveOperation().catch((err) => console.error(err)));

  return response;
};
```

### Use cases

- Sending emails
- Logging/analytics
- Cache warming
- Cleanup tasks

## Caching

### Cache API

```typescript
const cache = await caches.open('my-cache');

// Check cache
const cached = await cache.match(request);
if (cached) return cached;

// Fetch and cache
const response = await fetch(request);
await cache.put(request, response.clone());
return response;
```

### Cache best practices

- Never cache authenticated responses
- Never cache `/api/**` routes
- Set appropriate `Cache-Control` headers
- Use cache keys carefully

## Headers

### Cloudflare-specific headers

```typescript
// Get client IP
const ip = request.headers.get('cf-connecting-ip') || 'unknown';

// Get country
const country = request.headers.get('cf-ipcountry') || 'unknown';

// Get timezone
const timezone = request.headers.get('cf-timezone') || 'UTC';
```

### Set response headers

```typescript
return json(data, {
  headers: {
    'Cache-Control': 'public, max-age=300',
    'CDN-Cache-Control': 'public, max-age=3600', // Cloudflare cache
    'Cloudflare-CDN-Cache-Control': 'public, max-age=3600'
  }
});
```

## Deployment

### Environment variables

- Set in Cloudflare Dashboard (Pages/Workers)
- Never commit secrets to git
- Use `.dev.vars` for local development (add to `.gitignore`)

### Bindings

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "BETA_LOGS_KV"
id = "your-kv-id"

[[durable_objects.bindings]]
name = "TRIP_INDEX_DO"
class_name = "TripIndexDO"
script_name = "trip-index-worker"
```

## Error Handling

### Edge-specific errors

```typescript
try {
  await kv.put(key, value);
} catch (error) {
  // KV might be temporarily unavailable
  console.error('KV error:', error);
  throw error(503, 'Storage temporarily unavailable');
}
```

### Timeouts

- Requests timeout after 30 seconds (Workers)
- Requests timeout after 100 seconds (Pages Functions)
- Use `platform.context.waitUntil()` for long tasks

## Limits

### Workers limits

- CPU time: 10ms (free), 50ms (paid)
- Memory: 128 MB
- Request size: 100 MB
- Response size: 100 MB

### KV limits

- Reads: unlimited
- Writes: 1000/second per key
- List operations: 1000/second

### Durable Objects limits

- CPU time: 30 seconds per request
- Memory: 128 MB
- WebSocket connections: unlimited (within memory)

## Testing

### Local development

```bash
# Install Wrangler CLI
npm install -D wrangler

# Run locally with bindings
npm run dev
```

### Environment parity

- Use same binding names in dev and prod
- Test with actual KV/DO, not mocks
- Use `wrangler tail` to view logs

## Security

### Secrets management

- Store secrets in Cloudflare Dashboard
- Access via `platform.env`
- Never log secrets
- Rotate secrets regularly

### Rate limiting

```typescript
import { checkRateLimit } from '$lib/server/rateLimit';

const ip = request.headers.get('cf-connecting-ip') || 'unknown';
const allowed = await checkRateLimit(platform.env.KV, ip, 'endpoint', 100, 60);

if (!allowed) {
  throw error(429, 'Too many requests');
}
```

## Migration from Node.js

### Common replacements

```typescript
// ❌ Node.js
import path from 'path';
const filepath = path.join(__dirname, 'file.txt');

// ✅ Web APIs
const url = new URL('./file.txt', import.meta.url);

// ❌ Node.js
import crypto from 'crypto';
const hash = crypto.createHash('sha256').update(data).digest('hex');

// ✅ Web Crypto
const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
const hash = Array.from(new Uint8Array(buffer))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');
```
