# Progressive Web App (PWA) Rules

This repository is a **PWA-first application**.

All changes must preserve **installability**, **offline behavior**,
and **service worker correctness**. These rules are enforced by CI
and must never be bypassed.

---

## Core Principles (Non-Negotiable)

- The app must always be installable as a PWA
- Offline behavior must continue to function after any change
- Service worker registration must remain intact
- CI must pass with zero warnings or errors

If a change risks breaking PWA behavior:
**STOP and ask before proceeding.**

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

---

## Service Worker Rules

- Service worker registration must remain functional
- Do not rename, remove, or disable the service worker without explicit approval
- Updates must not break existing caches
- Cache versioning must be intentional and explicit

Forbidden:

- Uncontrolled cache clearing
- Breaking offline navigation
- Blocking critical routes when offline

---

## SvelteKit Integration

- Service worker must be compatible with SvelteKit's build output
- Ensure `service-worker.js` is in the correct static directory (`static/` or `src/service-worker.js`)
- Verify manifest is accessible and served correctly
- Service worker must handle SvelteKit's client-side routing
- Prerendered pages should be cached appropriately

---

## Offline Behavior

The following must continue to work offline where applicable:

- App shell loading
- Previously visited routes
- Cached assets (CSS, JS, icons)
- Local state persistence

Offline regressions are considered **breaking changes**.

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

- Verify service worker registers successfully
- Verify install prompt still appears (where applicable)
- Verify offline mode works via DevTools
- Ensure Lighthouse PWA score does not regress
- Test on actual mobile devices when possible

---

## Forbidden Changes

❌ Removing PWA metadata  
❌ Disabling service workers  
❌ Regressing offline support  
❌ Reducing Lighthouse PWA compliance  
❌ Breaking manifest.json structure  
❌ Removing or invalidating icons

---

## Enforcement

Violations of these rules will:

- Fail CI
- Be rejected by AI_GUARD rules
- Block merges

If compliance is unclear:
**STOP and ask instead of guessing.**

---

## Migration Note

When migrating Svelte 4 → Svelte 5:

- Verify service worker continues to work with new build output
- Check that routing changes don't break offline navigation
- Ensure build artifacts are still cacheable
- Test PWA functionality after migration
