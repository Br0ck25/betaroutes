# Security Policy

**CRITICAL:** This application handles sensitive user data (**locations** and **financials**).
All requirements in this document are **NON‑NEGOTIABLE** and have **HIGHEST PRECEDENCE** over product, DX, and performance goals.

---

## Sensitive data inventory

- **Auth credentials:** Session cookies / session identifiers
- **Financial data:** Trip earnings, mileage rates, payouts
- **Location data:** Start/end addresses, routes, coordinates, place IDs
- **Identity:** User IDs, email, usernames

---

## Threat model baseline

We assume an attacker can:

- Tamper with any client state (DevTools), including request bodies, headers, and cookies that are not `HttpOnly`
- Replay or script requests at high volume
- Attempt IDOR (Insecure Direct Object Reference) by guessing IDs/keys
- Exploit XSS to read browser storage and DOM
- Abuse caching (service worker, CDN) to retrieve another user’s data

**Security goals:**

1. **Isolation:** One user must never read or enumerate another user’s data.
2. **Zero trust client:** The server is the source of truth for identity, authorization, and calculations.
3. **No accidental caching of private data:** Neither SW nor edge caches may store authenticated responses.

---

## 1) Identity, sessions, and CSRF

### Session rules (mandatory)

- **Only cookie-based sessions are allowed** (no JWTs in browser storage).
- Cookies MUST be:
  - `HttpOnly`
  - `Secure`
  - `SameSite=Strict` (or `Lax` only if Strict breaks a required flow)
  - Set with a narrow `Path` and appropriate `Max-Age` / expiration
- **Logout MUST invalidate the session server-side** and clear the cookie client-side.
- **Never** store session tokens, refresh tokens, or secrets in:
  - `localStorage`
  - `sessionStorage`
  - IndexedDB

### CSRF protections (mandatory)

All state-changing routes (**POST/PUT/PATCH/DELETE**) MUST enforce CSRF protection:

- Validate `Origin` (and `Referer` as a backup) against the expected site origin **AND**
- Use a CSRF token mechanism (recommended: double-submit cookie + header) for requests from the browser.

If a route cannot validate CSRF, it must be redesigned.

### Rate limiting & enumeration (mandatory)

- Rate-limit authentication endpoints (login, register, password reset, email verify).
- Responses MUST NOT leak whether an email/username exists (no account enumeration).

---

## 2) Data isolation & authorization (Cloudflare KV / Durable Objects)

**Context:** Data is stored in Cloudflare KV (and/or Durable Objects).
**Risk:** Without strict scoping, a single endpoint can enumerate or access other users’ data.

### 🚫 Forbidden patterns

- **Global lists:** `KV.list({ prefix: "trips:" })` (enumerates all users)
- **Predictable IDs:** Auto-increment keys like `trip:101`
- **Client-defined keys:** Letting the client provide the full KV key or the owner identifier
- **Fallback auth:** Using `email`, `username`, or any client-supplied identifier for authorization

### ✅ Mandatory pattern: composite keys (server-derived)

All keys MUST be scoped by the authenticated user ID.

- User IDs MUST be **unguessable** (UUID/ULID). **Never** use email/username as a KV prefix.
- The server MUST derive the key prefix from `locals.user.id`, never from request data.

```ts
// ✅ CORRECT: key derived from authenticated session
const key = `trip:${locals.user.id}:${tripId}`;

// ❌ WRONG: trusting client-provided userId
const key = `trip:${requestData.userId}:${tripId}`;
```

### Mandatory data access protocol (every endpoint)

Every endpoint that touches user data MUST follow this exact sequence:

1. **Authenticate:** `locals.user` must exist (hooks can enforce, but endpoints must still guard).
2. **Authorize by scope:** Only access keys under `trip:${locals.user.id}:` (or equivalent).
3. **Validate inputs:** Parse/validate request payloads; reject unknown fields (see §3).
4. **Read/write:** Perform operation; never cross the user prefix boundary.

```ts
// src/routes/api/trips/+server.ts
import { json, error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');

  const KV = platform?.env.KV;
  if (!KV) throw error(500, 'Storage unavailable');

  const prefix = `trip:${locals.user.id}:`;
  const list = await KV.list({ prefix });

  // Fetch and return only this user's values...
  return json({ keys: list.keys.map((k) => k.name) });
};
```

> If you add Durable Objects, the same rule applies: the DO must validate `locals.user.id` and scope all reads/writes to that user.

---

## 3) API input validation & “zero trust client”

### “Zero trust client” (mandatory)

The client is hostile. It can manipulate JavaScript, storage, and network requests.

- **Never trust client math.**
  - If the client sends `{ mileage, payout }`, treat it as untrusted and recompute server-side.
  - The client may send **inputs** (e.g., start/end, timestamps); the server computes totals.

### Mass assignment (mandatory)

- **Never** write `await request.json()` directly to storage.
- Always **allowlist** fields via destructuring + schema validation.

```ts
// ❌ VULNERABLE
const data = await request.json();
await KV.put(key, JSON.stringify(data)); // attacker can inject fields (e.g., isAdmin)

// ✅ SECURE
const body = await request.json();
const { date, mileage } = body; // allowlist
await KV.put(key, JSON.stringify({ date, mileage, userId: locals.user.id }));
```

### Validation requirements (mandatory)

- Use schema validation (e.g., Zod) for all request payloads.
- Reject unknown keys (strict mode), not just missing/invalid ones.
- Validate:
  - IDs (format and ownership)
  - Dates/times
  - Numeric ranges (mileage, rate, currency values)
  - Strings (length, character restrictions as needed)

---

## 4) Browser storage, PWA offline-first, and caching

### 🚫 Forbidden storage (zero tolerance)

- `localStorage` / `sessionStorage`: **Never** store session tokens, passwords, reset keys, or PII.
- Service worker cache: **Never** cache authenticated API responses or user data.

### ✅ Allowed storage (strict)

- **Session:** `HttpOnly` cookies only.
- **Offline data:** IndexedDB is allowed **only** for:
  - Non-sensitive UI state (toggles, theme), OR
  - Explicitly user-approved offline mode data, with strict safeguards:
    - Minimal PII (prefer derived data or opaque IDs)
    - Cleared on logout AND on account switch
    - No secrets persisted
    - If sensitive data must be stored, it must be encrypted with WebCrypto and a key **not** persisted to disk (requires a deliberate design; default is to avoid offline PII)

### Service worker caching policy (mandatory)

The service worker MUST implement an **allowlist** cache strategy:

- ✅ Cache:
  - Static assets (JS/CSS/fonts/icons)
  - App shell routes required for offline boot
- 🚫 Never cache:
  - `/api/**`
  - Any route that can contain user-specific HTML/data (e.g., `/dashboard/**`)
  - Responses with `Set-Cookie`
  - Anything with `Authorization` headers

Additionally:

- All `/api/**` responses MUST include: `Cache-Control: no-store`
- Authenticated HTML/data responses MUST include: `Cache-Control: no-store` and `Vary: Cookie`

---

## 5) XSS & Svelte 5 rules

### HTML injection (mandatory)

- ❌ Never use `{@html userContent}`.
- ✅ Always render user content via normal bindings (`{userContent}`) so Svelte escapes it.

If HTML rendering is truly required, sanitize **server-side** before sending to the client (and document the sanitizer and allowlist).

### Load serialization / state leakage (mandatory)

- ❌ Never return sensitive data from `load` unless it is explicitly scoped to the authenticated user and required for the page.
- Remember: SvelteKit can serialize `load` output into HTML. Accidental inclusion of another user’s data becomes visible in “View Source”.

---

## 6) Deployment, secrets, and configuration

### Secrets (mandatory)

- ❌ Never commit `.dev.vars`, `.env`, or any secret file to git.
- ✅ Secrets MUST be stored in Cloudflare Pages/Workers environment variables and accessed server-side via `platform.env`.

### Client exposure (mandatory)

- ❌ Never expose private API keys in `+page.svelte` or client bundles.
- Only public keys intended for browser use may be exposed, and must be treated as public.

---

## 7) Security headers (mandatory)

The deployment MUST set these headers:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Content-Security-Policy: ...` (nonce-based; no `unsafe-inline` for scripts)
- `Referrer-Policy: no-referrer` (or a stricter variant that fits product needs)
- `Permissions-Policy: ...` (deny by default; allow only required features)
- `X-Content-Type-Options: nosniff`
- `Cross-Origin-Opener-Policy: same-origin` (if compatible)
- `Cross-Origin-Resource-Policy: same-site` (if compatible)
- Prefer CSP `frame-ancestors 'none'` (or a strict allowlist) instead of legacy X-Frame-Options.

---

## 8) Logging & telemetry (mandatory)

- Never log:
  - Passwords
  - Reset keys/tokens
  - Session IDs / cookies
  - Full addresses or precise coordinates (unless absolutely required and explicitly approved)
- Log only:
  - Request ID
  - User ID (internal UUID/ULID)
  - High-level route/action
  - Error codes (sanitized)

---

## 9) AI agent rules (strict)

For Copilot / AI assistants generating code in this repo:

You MUST:

- Refuse to use `localStorage` / `sessionStorage` for sensitive data.
- Refuse to write `{@html}` without documented server-side sanitization.
- Refuse to write API endpoints that accept `userId` (or owner) from the request body; identity MUST come from `locals.user`.
- Always use SvelteKit `RequestEvent` handlers (`({ platform, locals, request, url })`) — not Worker-style `(env, ctx)` handlers.
- Maintain strict allowlists for input handling; no mass-assignment.

**Violation response template:**

> “I cannot implement this request because it violates the Security Policy (Zero Trust Client / Data Isolation). I will implement a secure alternative: [secure alternative].”
