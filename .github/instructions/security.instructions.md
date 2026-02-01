---
description: 'Security rules for client and server code'
applyTo: 'src/**/*.{svelte,ts,js}'
---

# Security Rules

## Never trust input

- Validate and sanitize all user-controlled input (params, query, body, headers)
- Enforce authentication/authorization consistently (fail closed)
- Reject unexpected fields (don't silently accept)

## Sensitive data

- Never log secrets/tokens/PII (passwords, session IDs, API keys, addresses)
- Do not leak internal errors to clients; return safe, generic error messages
- Never expose `platform.env` or secrets to client code

## Web security basics

- Use CSRF protections: all mutations MUST use `csrfFetch` from `$lib/utils/csrf`
- Set safe cookies: `HttpOnly`, `Secure`, `SameSite=Strict` for session cookies
- Rate-limit sensitive endpoints (login, register, password reset, delete, exports)
- Validate file uploads (type, size, content)

## Client-Side Security

### No secrets in client bundles

- Never import server files (`$lib/server/**`) in client code
- Use `platform.env` for secrets (server-side only)
- No API keys, database credentials, or encryption keys in client code

### Browser storage

- No sensitive data in `localStorage` or `sessionStorage`
- No passwords, tokens, or PII in browser storage
- Use `HttpOnly` cookies for session tokens
- Clear storage on logout: `clearUserData(userId)`

### IndexedDB security

- NEVER access IndexedDB directly: `db.getAll('trips')` is FORBIDDEN
- ALWAYS use security wrappers from `$lib/db/queries.ts`:
  - `getUserTrips(userId)` not `db.getAll('trips')`
  - `saveUserTrip(trip, userId)` not `db.put('trips', trip)`
- Clear IndexedDB on logout: `clearUserData(userId)`

## PWA Caching (CRITICAL)

### Service Worker rules

- NEVER cache `/api/**` routes in service worker
- NEVER cache responses with `Set-Cookie` header
- NEVER cache user-specific responses
- Only cache: app shell, public assets, static files

### Offline data

- Use IndexedDB for offline queues, NOT service worker cache
- Sync queue items MUST include `userId` for isolation
- Clear offline data on logout

## Sync Queue Isolation

- `syncManager.addToQueue()` MUST receive `userId` parameter
- Every queue item MUST include `userId` for proper cleanup
- Logout MUST call `clearUserData(userId)` to prevent cross-user contamination

## CSRF Protection

### Client-side

- ALL mutations (POST/PUT/DELETE) MUST use `csrfFetch` from `$lib/utils/csrf`
- Never use raw `fetch()` for state-changing requests
- Example:

  ```typescript
  import { csrfFetch } from '$lib/utils/csrf';

  // ✅ CORRECT
  await csrfFetch('/api/trips', {
    method: 'POST',
    body: JSON.stringify(data)
  });

  // ❌ WRONG
  await fetch('/api/trips', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  ```

### Server-side

- Validate CSRF token on all mutations
- Check `Origin` and `Referer` headers
- Use double-submit cookie pattern

## Content Security

### XSS Prevention

- Never use `{@html}` with untrusted content
- If HTML rendering is required, sanitize server-side first
- Use Text Content, not innerHTML in JavaScript

#### Sanitization Best Practices

```typescript
// Server-side sanitization (if HTML rendering is absolutely required)
import DOMPurify from 'isomorphic-dompurify';

export const POST: RequestHandler = async ({ request }) => {
  const { userContent } = await request.json();
  
  // Sanitize with strict config
  const clean = DOMPurify.sanitize(userContent, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'a'],
    ALLOWED_ATTR: ['href'],
    ALLOW_DATA_ATTR: false
  });
  
  return json({ sanitized: clean });
};
```

#### Client-side Prevention

```svelte
<script lang="ts">
  let userInput = $state('');
  
  // ✅ CORRECT - Svelte escapes automatically
  function displaySafe(text: string) {
    return text; // Svelte will escape HTML
  }
  
  // ❌ WRONG - Direct innerHTML
  function displayUnsafe(text: string) {
    element.innerHTML = text; // XSS vulnerability!
  }
</script>

<!-- ✅ CORRECT - Automatically escaped -->
<p>{userInput}</p>

<!-- ❌ WRONG - Raw HTML -->
<p>{@html userInput}</p>
```

#### Content Security Policy

Your app already has CSP configured in `hooks.server.ts`:

```typescript
// Production CSP blocks inline scripts
const csp = [
  "default-src 'self'",
  "script-src 'self'", // No 'unsafe-inline'
  "style-src 'self' 'unsafe-inline'",
  // ... rest of CSP
].join('; ');
```

This prevents:

- Inline `<script>` tags from executing
- `javascript:` URLs
- Event handler injection (`onclick="malicious()"`)

### Injection Prevention

- Parameterize all database queries
- Validate and sanitize all user input
- Escape output appropriately for context (HTML, URL, JS)

#### SQL Injection Prevention

```typescript
// ✅ CORRECT - Parameterized query (if using D1/SQL)
const result = await db
  .prepare('SELECT * FROM users WHERE email = ?')
  .bind(email)
  .all();

// ❌ WRONG - String concatenation
const result = await db
  .prepare(`SELECT * FROM users WHERE email = '${email}'`)
  .all();
```

#### Command Injection Prevention

```typescript
// ❌ WRONG - User input in shell command
import { exec } from 'child_process';
exec(`convert ${userFilename} output.jpg`); // DANGEROUS!

// ✅ CORRECT - Validate and sanitize
const safeFilename = userFilename.replace(/[^a-zA-Z0-9._-]/g, '');
if (!/^[a-zA-Z0-9._-]+$/.test(safeFilename)) {
  throw error(400, 'Invalid filename');
}
// Use array form instead of shell interpolation
execFile('convert', [safeFilename, 'output.jpg']);
```

#### URL Injection Prevention

```svelte
<script lang="ts">
  function validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Only allow http/https
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }
  
  let userUrl = $state('');
  let safeUrl = $derived(validateUrl(userUrl) ? userUrl : '#');
</script>

<!-- ✅ CORRECT - Validated URL -->
<a href={safeUrl} target="_blank" rel="noopener noreferrer">Link</a>

<!-- ❌ WRONG - Unvalidated user input -->
<a href={userUrl}>Link</a>
```

### Path Traversal Prevention

```typescript
// ❌ WRONG - User-controlled path
const filePath = `/uploads/${userFilename}`;
const file = await readFile(filePath);

// ✅ CORRECT - Validate and restrict to safe directory
import path from 'path';

const safeFilename = path.basename(userFilename); // Remove directory traversal
const uploadDir = '/uploads';
const filePath = path.join(uploadDir, safeFilename);

// Ensure path is still within upload directory
if (!filePath.startsWith(uploadDir)) {
  throw error(400, 'Invalid path');
}
```

## File Upload Security

### Validation Requirements

```typescript
export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get('file') as File;
  
  // 1. Check file exists
  if (!file) throw error(400, 'No file provided');
  
  // 2. Check file size (10MB max)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw error(400, 'File too large');
  }
  
  // 3. Check MIME type (allowlist)
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw error(400, 'Invalid file type');
  }
  
  // 4. Verify file signature (magic bytes)
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // JPEG: FF D8 FF
  // PNG: 89 50 4E 47
  const isValidJPEG = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isValidPNG = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E;
  
  if (!isValidJPEG && !isValidPNG) {
    throw error(400, 'Invalid file signature');
  }
  
  // 5. Generate safe filename (don't trust user filename)
  const ext = file.type === 'image/jpeg' ? 'jpg' : 'png';
  const safeFilename = `${crypto.randomUUID()}.${ext}`;
  
  // Process file...
};
```

## Authentication & Authorization

See `server-security_instructions.md` for server-side rules.

## Security Headers Checklist

Your `hooks.server.ts` should set these headers (verify they're present):

```typescript
response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('X-Frame-Options', 'DENY');
response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
```

## Audit Logging

For security-critical operations, log:

```typescript
// ✅ CORRECT - Secure audit logging
await logSecurityEvent({
  action: 'password_reset_requested',
  userId: user.id, // Not email or username
  ip: request.headers.get('cf-connecting-ip'),
  timestamp: new Date().toISOString(),
  metadata: {
    // Don't log sensitive data
    requestId: crypto.randomUUID()
  }
});

// ❌ WRONG - Logging sensitive data
console.log('Password reset for', user.email, 'token:', resetToken);
```
