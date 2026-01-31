---
description: 'Server-side security rules (CRITICAL)'
applyTo: 'src/routes/**/+server.ts,src/routes/**/+page.server.ts,src/lib/server/**/*.ts,src/**/*.server.ts'
---

# Server Code Security Rules (CRITICAL)

## Zero Trust Client (HIGHEST PRIORITY)

### Never trust client-provided identity
- NEVER accept `userId`, `owner`, or any identity claims from:
  - Request body: `const { userId } = await request.json()` ❌
  - Query parameters: `url.searchParams.get('userId')` ❌
  - Route parameters: `params.userId` ❌ (unless validated against session)
  - Headers (except authentication tokens)

### Always derive ownership from session
- ALWAYS use `locals.user.id` from authenticated session
- This comes from `hooks.server.ts` session validation
- Example:
  ```typescript
  // ✅ CORRECT
  export const POST: RequestHandler = async ({ locals, request, platform }) => {
    if (!locals.user) throw error(401, 'Unauthorized');
    
    const userId = locals.user.id; // From session only
    const key = `trip:${userId}:${tripId}`;
  };
  
  // ❌ WRONG - accepting userId from client
  export const POST: RequestHandler = async ({ request, platform }) => {
    const { userId } = await request.json(); // FORBIDDEN
    const key = `trip:${userId}:${tripId}`;
  };
  ```

## Mass Assignment Protection (CRITICAL)

### Never spread request body into storage
- NEVER: `const data = await request.json(); await kv.put(key, JSON.stringify(data))`
- This allows attackers to inject fields like `isAdmin: true`

### Always allowlist fields explicitly
```typescript
// ❌ WRONG - mass assignment vulnerability
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const data = await request.json();
  await platform.env.KV.put(key, JSON.stringify(data)); // Dangerous!
};

// ✅ CORRECT - explicit allowlist
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401);
  
  const body = await request.json();
  const { date, mileage, notes } = body; // Allowlist only expected fields
  
  const trip = {
    date,
    mileage,
    notes,
    userId: locals.user.id, // Server-controlled field
    createdAt: new Date().toISOString() // Server-controlled field
  };
  
  await platform.env.KV.put(key, JSON.stringify(trip));
};
```

## Composite Key Pattern (CRITICAL)

### All storage keys MUST be user-scoped
- Pattern: `{resource}:${locals.user.id}:${resourceId}`
- Examples:
  - `trip:${locals.user.id}:${tripId}`
  - `expense:${locals.user.id}:${expenseId}`
  - `settings:${locals.user.id}`

### NEVER use global prefixes
```typescript
// ❌ WRONG - global prefix (leaks all users' data)
const key = `trips:${tripId}`;
await kv.list({ prefix: 'trips:' }); // Returns all users' trips!

// ✅ CORRECT - user-scoped prefix
const userId = locals.user.id;
const key = `trip:${userId}:${tripId}`;
await kv.list({ prefix: `trip:${userId}:` }); // Only this user's trips
```

## Input validation

### Validate and normalize all input
- Validate all params, query parameters, body fields, and headers
- Reject unexpected fields (don't silently accept)
- Use schema validation (Zod, Yup, etc.)

### Example validation
```typescript
import { z } from 'zod';

const TripSchema = z.object({
  date: z.string().datetime(),
  mileage: z.number().positive().max(10000),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401);
  
  const body = await request.json();
  const result = TripSchema.safeParse(body);
  
  if (!result.success) {
    throw error(400, 'Invalid input');
  }
  
  // Use validated data
  const { date, mileage, notes } = result.data;
};
```

## Authentication & Authorization

### Treat auth as mandatory for protected data
- Check `locals.user` at the start of EVERY protected route
- Fail closed: if no user, throw `error(401, 'Unauthorized')`
- Never return data without authorization check

### Authorization pattern
```typescript
export const GET: RequestHandler = async ({ locals, params, platform }) => {
  // 1. Authentication
  if (!locals.user) throw error(401, 'Unauthorized');
  
  // 2. Authorization (implicit via composite key)
  const key = `trip:${locals.user.id}:${params.id}`;
  const trip = await platform.env.KV.get(key);
  
  // 3. Not found vs Unauthorized
  if (!trip) throw error(404, 'Trip not found');
  
  return json(JSON.parse(trip));
};
```

## Secrets Management

### Never log secrets or personal data
- Never log: passwords, tokens, API keys, session IDs, full addresses
- Log only: sanitized identifiers, error codes, timestamps

### Use platform bindings
- Access secrets via `platform.env` (Cloudflare)
- NEVER use `process.env` (Node.js only, not available on edge)
- Example:
  ```typescript
  // ✅ CORRECT
  const apiKey = platform.env.PRIVATE_GOOGLE_MAPS_API_KEY;
  
  // ❌ WRONG
  const apiKey = process.env.GOOGLE_MAPS_API_KEY; // Doesn't work on edge
  ```

## Storage safety

### No plaintext passwords
- Always hash passwords with bcrypt, argon2, or scrypt
- Use appropriate cost factors
- Never store passwords in logs or temporary storage

### No tokens in browser storage
- Don't store session/auth tokens in `localStorage` or `sessionStorage`
- Use `HttpOnly`, `Secure`, `SameSite=Strict` cookies
- Clear cookies on logout

## CSRF Protection

### Server-side validation
- Validate CSRF token on all state-changing requests (POST/PUT/DELETE)
- Check `Origin` header matches expected origin
- Check `Referer` header as backup
- Use double-submit cookie pattern

### Implementation
```typescript
import { csrfProtection } from '$lib/server/csrf';

export const handle: Handle = async ({ event, resolve }) => {
  // Validate CSRF for mutations
  const csrfError = await csrfProtection(event);
  if (csrfError) return csrfError;
  
  // Continue processing
  return resolve(event);
};
```

## Rate Limiting

### Apply to sensitive endpoints
- Login, register, password reset
- Account deletion
- Data exports
- File uploads

### Example
```typescript
import { checkRateLimit } from '$lib/server/rateLimit';

export const POST: RequestHandler = async ({ request, platform }) => {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  
  const allowed = await checkRateLimit(
    platform.env.KV,
    ip,
    'login',
    5, // max attempts
    60 * 15 // 15 minutes
  );
  
  if (!allowed) {
    throw error(429, 'Too many requests');
  }
  
  // Continue with login...
};
```

## Error Handling

### Never leak internal details
- Return generic error messages to clients
- Log detailed errors server-side only
- Don't expose stack traces in production

### Example
```typescript
export const GET: RequestHandler = async ({ locals, platform }) => {
  try {
    if (!locals.user) throw error(401, 'Unauthorized');
    
    // ... operation
  } catch (err) {
    // Log detailed error server-side
    console.error('Error fetching trips:', err);
    
    // Return generic message to client
    throw error(500, 'An error occurred');
  }
};
```

## Response Headers

### Set appropriate cache headers
```typescript
// Protected data - never cache
return json(data, {
  headers: {
    'Cache-Control': 'no-store',
    'Vary': 'Cookie'
  }
});

// Public data - cache appropriately
return json(publicData, {
  headers: {
    'Cache-Control': 'public, max-age=300'
  }
});
```

## Anti-abuse

### Timing attack prevention
- Use constant-time comparison for sensitive strings
- Example:
  ```typescript
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }
  ```

### Prevent enumeration
- Don't leak whether accounts exist
- Use same response time for existing/non-existing accounts
- Return generic messages: "If an account exists, an email was sent"
