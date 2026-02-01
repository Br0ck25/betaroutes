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

### Advanced: Nested Object Protection

```typescript
// ❌ WRONG - Nested objects can be exploited
export const POST: RequestHandler = async ({ request, locals }) => {
  const { trip } = await request.json();
  // Attacker sends: { trip: { ...valid, isAdmin: true } }
  await saveTrip(trip);
};

// ✅ CORRECT - Validate nested structures
import { z } from 'zod';

const TripSchema = z.object({
  date: z.string().datetime(),
  start: z.object({
    address: z.string().max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  end: z.object({
    address: z.string().max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  mileage: z.number().positive().max(10000),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401);

  const body = await request.json();
  const result = TripSchema.safeParse(body);

  if (!result.success) {
    // Log validation errors (but don't send to client)
    console.error('Validation failed:', result.error);
    throw error(400, 'Invalid input');
  }

  const trip = {
    ...result.data,
    userId: locals.user.id,
    createdAt: new Date().toISOString()
  };

  await saveTrip(trip);
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

### Advanced Validation Patterns

#### Email Validation

```typescript
const EmailSchema = z.string().email().toLowerCase().max(254);

// Additional checks for disposable emails (optional)
const DISPOSABLE_DOMAINS = ['tempmail.com', '10minutemail.com'];

function validateEmail(email: string): boolean {
  const result = EmailSchema.safeParse(email);
  if (!result.success) return false;
  
  const domain = email.split('@')[1];
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return false;
  }
  
  return true;
}
```

#### URL Validation

```typescript
const UrlSchema = z.string().url().max(2048);

// Only allow specific protocols
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
```

#### Date Validation

```typescript
const DateSchema = z.string().datetime();

// Additional business logic validation
function validateTripDate(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  
  // Date must be within last year and not in future
  return date >= oneYearAgo && date <= now;
}
```

#### Enum Validation

```typescript
const CategorySchema = z.enum(['fuel', 'maintenance', 'insurance', 'other']);

// Or for dynamic enums from config:
const validCategories = ['fuel', 'maintenance', 'insurance'] as const;
const DynamicCategorySchema = z.enum(validCategories);
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

### Role-Based Access Control (if applicable)

```typescript
type UserRole = 'user' | 'admin' | 'premium';

function requireRole(user: { id: string; role: UserRole }, required: UserRole[]) {
  if (!required.includes(user.role)) {
    throw error(403, 'Forbidden');
  }
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401);
  
  // Require admin or premium
  requireRole(locals.user, ['admin', 'premium']);
  
  // Continue with admin/premium-only logic
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

### Secret Rotation Best Practices

```typescript
// Support multiple API keys for zero-downtime rotation
const API_KEYS = [
  platform.env.CURRENT_API_KEY,
  platform.env.PREVIOUS_API_KEY // Keep old key during transition
].filter(Boolean);

async function makeApiRequest(url: string) {
  // Try current key first
  for (const key of API_KEYS) {
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      
      if (response.ok) return response;
      if (response.status === 401) continue; // Try next key
      
      throw new Error(`API error: ${response.status}`);
    } catch (err) {
      console.error('API request failed:', err);
    }
  }
  
  throw error(500, 'All API keys failed');
}
```

## Storage safety

### No plaintext passwords

- Always hash passwords with bcrypt, argon2, or scrypt
- Use appropriate cost factors
- Never store passwords in logs or temporary storage

### Password Hashing Example

```typescript
import bcrypt from 'bcryptjs';

// Hashing (during registration)
const SALT_ROUNDS = 12;
const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

// Verification (during login)
const isValid = await bcrypt.compare(password, hashedPassword);

// ❌ WRONG - Weak hashing
const hash = crypto.createHash('sha256').update(password).digest('hex');

// ❌ WRONG - Low cost factor
const weakHash = await bcrypt.hash(password, 4); // Too fast!
```

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

### Advanced Rate Limiting

```typescript
// Sliding window rate limiting
interface RateLimitConfig {
  maxAttempts: number;
  windowSeconds: number;
  blockDurationSeconds?: number;
}

async function checkAdvancedRateLimit(
  kv: KVNamespace,
  identifier: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - (config.windowSeconds * 1000);
  
  // Get existing attempts
  const data = await kv.get(key, { type: 'json' }) as { attempts: number[]; blockedUntil?: number } | null;
  
  // Check if blocked
  if (data?.blockedUntil && data.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: data.blockedUntil
    };
  }
  
  // Filter attempts within window
  const recentAttempts = (data?.attempts || []).filter(t => t > windowStart);
  
  // Check limit
  if (recentAttempts.length >= config.maxAttempts) {
    const blockedUntil = config.blockDurationSeconds 
      ? now + (config.blockDurationSeconds * 1000)
      : undefined;
    
    await kv.put(key, JSON.stringify({
      attempts: recentAttempts,
      blockedUntil
    }), { expirationTtl: config.windowSeconds });
    
    return {
      allowed: false,
      remaining: 0,
      resetAt: blockedUntil || (recentAttempts[0] + config.windowSeconds * 1000)
    };
  }
  
  // Record new attempt
  recentAttempts.push(now);
  await kv.put(key, JSON.stringify({ attempts: recentAttempts }), {
    expirationTtl: config.windowSeconds
  });
  
  return {
    allowed: true,
    remaining: config.maxAttempts - recentAttempts.length,
    resetAt: recentAttempts[0] + (config.windowSeconds * 1000)
  };
}
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

### Production vs Development Error Handling

```typescript
import { dev } from '$app/environment';

export const POST: RequestHandler = async ({ request }) => {
  try {
    // ... operation
  } catch (err) {
    // Always log full error server-side
    console.error('[API Error]', {
      error: err,
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString()
    });
    
    // Return detailed error in dev, generic in production
    if (dev) {
      throw error(500, err instanceof Error ? err.message : 'Unknown error');
    } else {
      throw error(500, 'An error occurred');
    }
  }
};
```

### Structured Error Logging

```typescript
interface ErrorLog {
  level: 'error' | 'warn' | 'info';
  message: string;
  userId?: string;
  requestId?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

function logError(log: ErrorLog) {
  const structured = {
    ...log,
    timestamp: new Date().toISOString(),
    environment: dev ? 'development' : 'production'
  };
  
  // Send to logging service (e.g., Cloudflare Analytics, Sentry)
  console.error(JSON.stringify(structured));
}

// Usage
export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    // ...
  } catch (err) {
    logError({
      level: 'error',
      message: 'Failed to process payment',
      userId: locals.user?.id,
      requestId: crypto.randomUUID(),
      stack: err instanceof Error ? err.stack : undefined,
      metadata: {
        endpoint: '/api/payment',
        method: 'POST'
      }
    });
    
    throw error(500, 'Payment processing failed');
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
    Vary: 'Cookie'
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

### Account Enumeration Prevention Example

```typescript
export const POST: RequestHandler = async ({ request, platform }) => {
  const { email } = await request.json();
  
  // Always take the same amount of time
  const startTime = Date.now();
  
  const user = await findUserByEmail(platform.env.KV, email);
  
  if (user) {
    // Send password reset email
    await sendPasswordResetEmail(user);
  }
  
  // Constant-time response (minimum 200ms)
  const elapsed = Date.now() - startTime;
  const delay = Math.max(0, 200 - elapsed);
  await new Promise(resolve => setTimeout(resolve, delay));
  
  // Same response whether user exists or not
  return json({
    message: 'If an account with that email exists, a password reset link has been sent.'
  });
};
```

## Request Size Limits

```typescript
// Prevent DoS via large payloads
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB

export const POST: RequestHandler = async ({ request }) => {
  const contentLength = request.headers.get('content-length');
  
  if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
    throw error(413, 'Payload too large');
  }
  
  // Continue processing
};
```

## Security Checklist for New Endpoints

Before deploying a new API endpoint, verify:

- [ ] Authentication check (`if (!locals.user) throw error(401)`)
- [ ] User-scoped composite keys (`trip:${locals.user.id}:${id}`)
- [ ] Input validation with schema (Zod)
- [ ] No mass assignment (explicit allowlist)
- [ ] Appropriate rate limiting
- [ ] CSRF protection (handled by hooks)
- [ ] Correct cache headers (`no-store` for protected data)
- [ ] Generic error messages (no stack traces)
- [ ] Audit logging for sensitive operations
- [ ] No secrets in responses
