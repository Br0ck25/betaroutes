# Progressive Web App (PWA) Rules

This repository is a **PWA-first application**.

All changes must preserve **installability**, **offline behavior**, and **service worker correctness**.

---

## Core principles (non-negotiable)

- **Installable:** The app must meet browser installation criteria.
- **Offline-first:** Core features (viewing logs, queuing new trips) must work without network.
- **Zero trust caching:** We strictly separate **Public Assets** (cacheable) from **User Data** (never cacheable).

---

## Progressive enhancement & feature detection

We build with **progressive enhancement**: ship a robust baseline experience first.

Rules:

- **No User-Agent sniffing:** Branching on `navigator.userAgent` is forbidden.
- **Feature detection only:** Use `'serviceWorker' in navigator`, `'SyncManager' in window`, and `@supports` in CSS.
- **Graceful fallbacks:** If a feature is missing (e.g., Background Sync), UI must degrade cleanly (e.g., “Syncing…” → “Manual Sync Required”).

---

## Manifest requirements

The manifest is critical.

- **Location:** `static/manifest.json`
- **Required fields:**
  - `name`, `short_name`
  - `start_url` and `scope`
    - **Must work under a base path** (Cloudflare Pages/Workers subpath deploys).
    - Prefer **relative** values so the manifest works at `/` or a subpath:
      - `start_url: "."`
      - `scope: "."`
  - `display: "standalone"`
  - `background_color`, `theme_color` (must match `DESIGN_SYSTEM.md`)
  - `icons` (must exist in `static/`)
    - Include at least one **maskable** icon (`"purpose": "any maskable"`)
  - Strongly recommended:
    - `id` (stable app identity)
    - `description`

---

## Service worker rules (strict)

**Location:** `src/service-worker.ts` (SvelteKit standard)

### 1) Caching strategy

- ✅ **Precache:** App shell assets (JS/CSS/fonts/icons). SvelteKit’s `$service-worker` module provides `build`, `files`, `version`.
- ✅ **Navigation:** **Network-first** for HTML navigations (try network, fall back to offline shell/page).
- ❌ **Forbidden:** Caching authenticated or user-specific responses in Cache Storage.
- ❌ **Forbidden:** Caching API responses (`/api/**`) in Cache Storage.
  - **Reason:** Security. Sensitive JSON must not persist in global caches. Use **IndexedDB** for structured offline data instead.

**Mandatory bypass rules:**

- Requests to `/api/**` MUST be treated as **network-only** in the SW.
- Any response containing `Set-Cookie` MUST NOT be cached.
- Any request with credentials (cookies) MUST NOT be cached unless it is explicitly a public, non-user-specific asset.

### 2) SvelteKit integration (mandatory)

- The SW MUST import `{ build, files, version }` from `$service-worker`.
- It MUST:
  - handle `install` (precache build artifacts + static `files`)
  - handle `activate` (delete old caches by `version`)
  - use `version` as the cache key namespace

### 3) Updates (safe by default)

Updates must not silently break an active session.

- **Preferred:** show a UI prompt (“Update available → Reload”) and call `skipWaiting()` only after user consent.
- If you choose immediate updates, you MUST verify it cannot break in-flight work (offline queues, draft forms, etc.).

### 4) Kill switch (mandatory)

If a bad SW is deployed, we must be able to “self-destruct” it quickly.

Minimum kill-switch behavior:

- `self.registration.unregister()`
- delete all caches
- `clients.claim()` (so the cleanup applies immediately)

Example (deploy as an emergency SW):

```ts
self.addEventListener('install', (event) => {
  // @ts-expect-error - SW global
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      // @ts-expect-error - SW global
      self.clients.claim();
    })()
  );
});
```

---

## Offline data strategy

**Read:** `ARCHITECTURE.md` (ADR-004)

- **Write path (offline):** User actions (e.g., “Start Trip”) are written to **IndexedDB**.
- **Sync path (online):** A **Sync Engine** reads IndexedDB and POSTs to the server.
- **UI state:** The UI MUST show a clear **Pending** state for unsynced items.
- **Logout/account switch:** IndexedDB offline queues MUST be cleared (or re-keyed) to prevent cross-account leakage.

---

## API caching headers (mandatory)

Server routes that return user data MUST include:

- `/api/**`: `Cache-Control: no-store`
- Authenticated HTML/data routes: `Cache-Control: no-store` and `Vary: Cookie`

---

## Adapt to devices & input methods

- **Responsive:** Must work from 320px mobile to large desktop.
- **Inputs:** Support touch, mouse, and keyboard.
- **iOS:** Handle iOS PWA quirks (install flow, storage eviction, feature gaps across versions).

---

## Testing requirements

After any change that could affect PWA behavior:

1. **Lighthouse:** Run a PWA audit. **PWA category must be 100.**
2. **Offline reload:** DevTools → Offline. Reload. App must boot and show offline-ready UI.
3. **Offline queue:** Create an offline action. Confirm it is queued and marked Pending.
4. **Online sync:** Re-enable network. Confirm the Sync Engine flushes successfully.
5. **Installability:** Confirm browser indicates installability (or iOS add-to-home-screen flow is documented).

---

## Forbidden changes

❌ Removing required `manifest.json` properties.
❌ Caching `platform.env` or sensitive API data in Cache Storage.
❌ Caching `/api/**` responses in SW cache.
❌ Breaking the offline fallback/shell route.
❌ Using `localStorage` for offline queues (use IndexedDB).

---

## Enforcement

Violations of these rules will:

- Fail CI
- Be rejected by AI_GUARD rules

If compliance is unclear: **STOP and ask.**
