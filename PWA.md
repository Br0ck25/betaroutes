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

---

## Testing Requirements

After any change that could affect PWA behavior:

- Verify service worker registers successfully
- Verify install prompt still appears (where applicable)
- Verify offline mode works via DevTools
- Ensure Lighthouse PWA score does not regress

---

## Forbidden Changes

❌ Removing PWA metadata  
❌ Disabling service workers  
❌ Regressing offline support  
❌ Reducing Lighthouse PWA compliance  

---

## Enforcement

Violations of these rules will:
- Fail CI
- Be rejected by AI_GUARD rules
- Block merges

If compliance is unclear:
**STOP and ask instead of guessing.**
