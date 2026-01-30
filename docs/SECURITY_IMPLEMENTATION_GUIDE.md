# Security Implementation Files - Setup Guide

Complete implementation guide for the missing security files referenced in `hooks.server.ts`.

---

## Files Created

1. ✅ `src/lib/server/csrf.ts` - CSRF protection (double-submit cookie)
2. ✅ `src/lib/server/log.ts` - Structured logging (Cloudflare-compatible)
3. ✅ `src/lib/server/env.ts` - Environment/binding helpers
4. ✅ `src/lib/server/userService.ts` - Secure user data access

---

## Installation Steps

### Step 1: Create Directory Structure

```bash
mkdir -p src/lib/server
```

### Step 2: Copy Files

Place each file in `src/lib/server/`:

- `csrf.ts`
- `log.ts`
- `env.ts`
- `userService.ts`

### Step 3: Verify Imports

Your `hooks.server.ts` already imports these correctly:

```typescript
import { log } from '$lib/server/log';
import { findUserById } from '$lib/server/userService';
import { generateCsrfToken, csrfProtection } from '$lib/server/csrf';
```

### Step 4: Client-Side CSRF Integration

To use CSRF tokens in your client code, add this helper:

**File:** `src/lib/utils/csrf.ts`

```typescript
/**
 * Get CSRF token from cookie for client-side requests
 */
export function getCsrfToken(): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === '__csrf_token') {
      return value;
    }
  }
  return null;
}

/**
 * Make a fetch request with CSRF token
 */
export async function fetchWithCsrf(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getCsrfToken();

  if (!token) {
    throw new Error('CSRF token not found. Please refresh the page.');
  }

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'x-csrf-token': token
    }
  });
}
```

**Usage in components:**

```typescript
import { fetchWithCsrf } from '$lib/utils/csrf';

// In your component
async function saveTrip() {
  const response = await fetchWithCsrf('/api/trips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tripData)
  });
}
```

---

## Feature Highlights

### 1. CSRF Protection (`csrf.ts`)

**Features:**

- ✅ Double-submit cookie pattern
- ✅ Timing-safe comparison (prevents timing attacks)
- ✅ Automatic token generation per request
- ✅ Configurable exempt paths (webhooks, login, etc.)
- ✅ Clear error messages for users

**Exempt Paths (customize as needed):**

```typescript
const EXEMPT_PATHS = [
  '/api/webhooks/',
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register'
];
```

**Security:**

- Tokens are 32 bytes (256 bits) - cryptographically secure
- HttpOnly cookies prevent JavaScript access
- SameSite=Strict for maximum CSRF protection

### 2. Structured Logging (`log.ts`)

**Features:**

- ✅ Automatic sensitive data redaction
- ✅ JSON output for production (Cloudflare-compatible)
- ✅ Pretty console output for development
- ✅ Scoped loggers for different modules
- ✅ Error formatting with stack traces (dev only)

**Example Usage:**

```typescript
import { log, createLogger } from '$lib/server/log';

// Basic logging
log.info('User logged in', { userId: 'abc123' });
log.warn('Rate limit approaching', { requests: 95, limit: 100 });
log.error('Database connection failed', error);

// Scoped logger
const authLog = createLogger('Auth');
authLog.info('Login attempt', { username: 'alice' });
```

**Auto-Redacted Fields:**

- Passwords, secrets, tokens, keys
- Session IDs, cookies, API keys
- Credit cards, SSNs, private keys

### 3. Environment Helpers (`env.ts`)

**Features:**

- ✅ Safe KV namespace access (returns null instead of throwing)
- ✅ Durable Object binding helpers
- ✅ Secret validation and required checks
- ✅ Development fallbacks

**Example Usage:**

```typescript
import { getEnv, safeKV, requireSecret } from '$lib/server/env';

export const GET: RequestHandler = async ({ platform }) => {
  const env = getEnv(platform);

  // Safe KV access (returns null if missing)
  const kv = safeKV(env, 'BETA_LOGS_KV');
  if (!kv) {
    return json({ error: 'Storage unavailable' }, { status: 503 });
  }

  // Required secret (throws if missing)
  const apiKey = requireSecret(env, 'PRIVATE_GOOGLE_MAPS_API_KEY');

  // Optional secret (returns null if missing)
  const optionalKey = getSecret(env, 'OPTIONAL_API_KEY');
};
```

### 4. User Service (`userService.ts`)

**Features:**

- ✅ UUID v4 validation (per SECURITY.md)
- ✅ Composite key pattern (`user:{id}`)
- ✅ Username/email indexes (for backwards compatibility)
- ✅ Automatic index management
- ✅ Session-safe data stripping

**Example Usage:**

```typescript
import { findUserById, updateUser, toUserSession } from '$lib/server/userService';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401);

  const env = getEnv(platform);
  const kv = safeKV(env, 'BETA_USERS_KV');
  if (!kv) throw error(503);

  // Fetch user by ID (the secure way)
  const user = await findUserById(kv, locals.user.id);

  if (!user) throw error(404, 'User not found');

  // Return session-safe data (no passwordHash)
  return json(toUserSession(user));
};
```

**Key Patterns:**

```typescript
// Primary data
user:{userId}                    → User object

// Indexes (for lookup)
username:{username.toLowerCase()} → userId
email:{email.toLowerCase()}       → userId
```

---

## Testing

### Unit Tests Example

**File:** `src/lib/server/csrf.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { generateCsrfToken } from './csrf';

describe('CSRF Protection', () => {
  it('generates valid tokens', () => {
    const mockEvent = {
      cookies: {
        get: () => null,
        set: () => {}
      }
    } as any;

    const token = generateCsrfToken(mockEvent);
    expect(token).toHaveLength(64); // 32 bytes * 2 (hex)
  });
});
```

### Integration Test

```bash
# Test CSRF protection
curl -X POST http://localhost:5173/api/trips \
  -H "Content-Type: application/json" \
  -d '{"date":"2025-01-27"}'

# Should return 403 CSRF error

# With token
curl -X POST http://localhost:5173/api/trips \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: YOUR_TOKEN_HERE" \
  -b "__csrf_token=YOUR_TOKEN_HERE" \
  -d '{"date":"2025-01-27"}'

# Should succeed
```

---

## Configuration Options

### CSRF Exempt Paths

Edit `csrf.ts` to add more exempt paths:

```typescript
const EXEMPT_PATHS = [
  '/api/webhooks/',
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/your-custom-webhook' // Add here
];
```

### Log Level

Edit `log.ts` to change log level:

```typescript
// Show all logs in production (not recommended)
const CURRENT_LOG_LEVEL = LogLevel.DEBUG;

// Only errors in production (recommended for high-traffic)
const CURRENT_LOG_LEVEL = dev ? LogLevel.DEBUG : LogLevel.ERROR;
```

### Sensitive Field Patterns

Edit `log.ts` to add more sensitive patterns:

```typescript
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /your-custom-field/i // Add here
];
```

---

## Migration from Existing Code

If you have existing code that needs to be updated:

### 1. Replace Console Logs

**Before:**

```typescript
console.log('User logged in:', userId);
```

**After:**

```typescript
import { log } from '$lib/server/log';
log.info('User logged in', { userId });
```

### 2. Add CSRF to Forms

**Before:**

```svelte
<form method="POST" action="/api/trips">
  <!-- ... -->
</form>
```

**After:**

```svelte
<script lang="ts">
  import { fetchWithCsrf } from '$lib/utils/csrf';

  async function handleSubmit(event: Event) {
    event.preventDefault();
    const response = await fetchWithCsrf('/api/trips', {
      method: 'POST',
      body: formData
    });
  }
</script>

<form onsubmit={handleSubmit}>
  <!-- ... -->
</form>
```

### 3. Update User Lookups

**Before:**

```typescript
const user = JSON.parse(await KV.get(`user:${username}`));
```

**After:**

```typescript
import { findUserByUsername } from '$lib/server/userService';
const user = await findUserByUsername(KV, username);
```

---

## Troubleshooting

### Issue: "CSRF token missing"

**Cause:** Token not being sent from client

**Fix:** Ensure you're using `fetchWithCsrf` or manually adding the header:

```typescript
fetch(url, {
  headers: {
    'x-csrf-token': getCsrfToken()
  }
});
```

### Issue: "Platform environment unavailable"

**Cause:** Accessing `platform.env` outside of request handlers

**Fix:** Only access `platform` inside request handlers:

```typescript
// ✅ Correct
export const GET: RequestHandler = async ({ platform }) => {
  const env = getEnv(platform);
};

// ❌ Wrong (top-level module)
const env = getEnv(platform); // platform is undefined here
```

### Issue: "KV binding not found"

**Cause:** Binding not configured in `wrangler.toml` or not matching `app.d.ts`

**Fix:** Verify binding exists in both:

1. `wrangler.toml` - Actual Cloudflare binding
2. `src/app.d.ts` - TypeScript type definition

---

## Security Checklist

After implementing these files, verify:

- [ ] CSRF tokens are generated on all requests
- [ ] CSRF validation occurs on POST/PUT/PATCH/DELETE
- [ ] Sensitive data is redacted from logs
- [ ] User lookups use ID (not username/email) for authorization
- [ ] All secrets accessed via `platform.env`
- [ ] Client-side requests include CSRF token header
- [ ] Error messages don't leak sensitive information

---

## Performance Notes

### CSRF Token Caching

Tokens are reused across requests within the same session (24h lifetime) to avoid constant regeneration.

### KV Caching

User lookups are not cached by default. For high-traffic applications, consider:

1. Adding a cache layer (Cloudflare Cache API)
2. Using Durable Objects for session state

### Logging Volume

In production with high traffic:

- Consider increasing `CURRENT_LOG_LEVEL` to `WARN` or `ERROR`
- Use Cloudflare Logpush for log aggregation
- Set up alerts for ERROR-level logs

---

## Next Steps

1. **Test the security files**

   ```bash
   npm run gate
   npm run test
   ```

2. **Update client code** to use `fetchWithCsrf`

3. **Review CSRF exempt paths** and customize for your needs

4. **Set up log monitoring** in Cloudflare dashboard

5. **Verify all KV bindings** match between `wrangler.toml` and `app.d.ts`

---

## Support

If you encounter issues:

1. Check the analysis file: `SVELTE_FILES_ANALYSIS.md`
2. Review `ERROR_PATTERNS_AND_STOP_CONDITIONS.md`
3. Ensure `npm run gate` passes
4. Check Cloudflare Workers logs for runtime errors
