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

### Injection Prevention
- Parameterize all database queries
- Validate and sanitize all user input
- Escape output appropriately for context (HTML, URL, JS)

## Authentication & Authorization

See `server-security.instructions.md` for server-side rules.
