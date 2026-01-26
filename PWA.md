# Progressive Web App (PWA) Rules

This repository is a **PWA-first application**.

All changes must preserve **installability**, **offline behavior**, and **service worker correctness**.
These rules are enforced by CI and must never be bypassed.

PWAs must also work as **regular web apps in browsers** (not just as installed apps). Changes must be safe across
different browsers, devices, and input methods.

---

## Core Principles (Non-Negotiable)

- The app must always be installable as a PWA
- The app must remain usable in a normal browser tab (non-installed)
- Offline behavior must continue to function after any change
- Service worker registration must remain intact
- Deep links (any route URL) must remain navigable/shareable
- CI must pass with zero warnings or errors

If a change risks breaking PWA behavior:
**STOP and ask before proceeding.**

---

## Progressive Enhancement & Feature Detection (Required)

We build with **progressive enhancement**: ship a robust baseline experience first, then layer on capabilities where
they exist.

Rules:

- Never assume a capability exists just because a browser is “modern”.
- **Do not use user-agent sniffing** to branch logic.
- Use **feature detection**:
  - JavaScript: check for API entry points (e.g., `'serviceWorker' in navigator`, `'caches' in globalThis`).
  - CSS: prefer `@supports (...) { ... }` for CSS feature gating; use `CSS.supports()` only when you truly need JS.
- Provide accessible fallbacks where possible.
- If a feature is required for core UX, implement a **fallback flow** (or an explicit, user-friendly “not supported”
  state) rather than crashing.

---

## Manifest Requirements

The following must never be removed or invalidated:

- `manifest.json`
- Required fields:
  - `name`
  - `short_name`
  - `start_url`
  - `display`
  - `icons`
  - `theme_color`
  - `background_color`

Rules:

- Icons must exist at declared paths
- No invalid MIME types
- No breaking changes to `start_url`
- Manifest must be served with correct MIME type (`application/manifest+json`)
- Changes to `start_url` / `scope` must be coordinated with any subpath hosting (e.g., Cloudflare Pages base paths)

---

## Service Worker Rules

- Service worker registration must remain functional
- Do not rename, remove, or disable the service worker without explicit approval
- Updates must not break existing caches
- Cache versioning must be intentional and explicit
- The app must remain usable when the service worker is unavailable (first visit, unsupported browser, or SW disabled)

Forbidden:

- Uncontrolled cache clearing
- Breaking offline navigation
- Blocking critical routes when offline
- Installing a service worker that can “brick” the app on update (always keep a safe offline fallback)

---

## Offline Behavior

Users expect installed apps to work on slow, unreliable networks — and when fully offline.

Minimum requirement:

- Provide a **custom offline fallback** (not the browser’s generic offline error page) for navigations and critical
  routes.

Recommended (where applicable):

- Keep the app shell loadable offline
- Allow users to continue core tasks offline (queue actions locally and sync when back online)
- Ensure previously visited routes remain available offline when feasible
- Cache static assets (CSS, JS, icons) safely and predictably
- Persist local state drafts so work is not lost on refresh/offline

Offline regressions are considered **breaking changes**.

---

## Deep Linking & Navigation

- Every meaningful view must have a unique URL (deep link).
- Do not replace URL-based navigation with state-only navigation.
- If a user pastes a deep link into a browser, it must load (online) and remain compatible with offline fallbacks.

---

## Adapt to Devices & Input Methods

- UI must remain usable on all viewport sizes (responsive layout).
- Do not ship “desktop-only” interactions:
  - keyboard + mouse
  - touch / stylus
- Prefer semantic HTML elements for interactive controls (buttons, forms, inputs) instead of div-based controls.

---

## Performance & Accessibility (Non-Negotiable)

- Keep startup and navigation fast; avoid blocking the main thread with long synchronous work.
- Avoid large, unnecessary dependencies; measure impact before adding.
- Accessibility is required:
  - keyboard navigation
  - focus visibility and logical focus order
  - readable contrast and scalable text
  - appropriate labels/ARIA only when semantic HTML cannot express the intent

---

## Update Strategy

- Use safe, forward-compatible cache strategies
- Avoid aggressive cache invalidation
- Prefer additive changes over destructive updates

If an update requires cache invalidation:

- Document the reason
- Verify offline behavior manually
- Test across multiple devices/browsers

---

## Testing Requirements

After any change that could affect PWA behavior:

- Verify the manifest is valid and served correctly
- Verify service worker registers successfully and updates safely
- Verify install prompt still appears (where applicable)
- Verify offline mode works via DevTools and in a real “offline” scenario
- Verify deep links load directly (fresh tab) and still work with offline fallbacks
- Ensure Lighthouse PWA score does not regress
- Test across multiple browsers and at least one mobile device when possible

---

## Forbidden Changes

❌ Removing PWA metadata  
❌ Disabling service workers  
❌ Regressing offline support  
❌ Breaking deep links / routing  
❌ Reducing Lighthouse PWA compliance  
❌ Breaking manifest.json structure  
❌ Removing or invalidating icons  
❌ Browser sniffing for feature support

---

## Enforcement

Violations of these rules will:

- Fail CI
- Be rejected by AI_GUARD rules
- Block merges

If compliance is unclear:
**STOP and ask instead of guessing.**

---

## SvelteKit Integration

- Service worker must be compatible with SvelteKit's build output
- Ensure `service-worker.ts` is in the correct static directory (`static/` or `src/service-worker.ts`)
- Verify manifest is accessible and served correctly
- Service worker must handle SvelteKit's client-side routing
- Prerendered pages should be cached appropriately

---

## Migration Note

When migrating Svelte 4 → Svelte 5:

- Verify service worker continues to work with new build output
- Check that routing changes don't break offline navigation
- Ensure build artifacts are still cacheable
- Test PWA functionality after migration
