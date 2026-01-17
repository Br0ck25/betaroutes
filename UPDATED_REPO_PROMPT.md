---
applyTo: '**'
---

# Repository Governance Prompt

This repository **enforces Svelte 5 runes-based reactivity and the HTML Living Standard**.
It is a **mixed Svelte 4 / Svelte 5 codebase** with a controlled, file-by-file migration.

Legacy syntax is allowed **only** in files explicitly marked with documented
migration boundaries. Mixing legacy and runes syntax in the same file will fail
local hooks and CI.

This is a **Progressive Web App (PWA)**.

All changes must preserve:

- installability
- service worker registration
- offline / caching behavior
- manifest validity

---

## Mandatory Reading (Before Any Changes)

You MUST read and follow:

- README.md
- CONTRIBUTING.md
- AI_GUARD.md
- HTML_LIVING_STANDARD.md

If there is a conflict, **CI enforcement wins**.

---

## Svelte Rules (Strict)

- Target: **Svelte 5**
- **All new code must use runes-based reactivity**
  - `$state`
  - `$derived`
  - `$effect`
- Do not mix legacy and runes syntax in the same file
- Files must clearly belong to either:
  - **Svelte 4 (legacy)**, or
  - **Svelte 5 (migrated)**

### Permanently Forbidden (All Files)

- `svelte/store`
- `onMount`
- `beforeUpdate` / `afterUpdate`
- `createEventDispatcher`
- class-based component instantiation

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)**
- No XHTML / XML-style syntax
- No deprecated elements or attributes
- Prefer semantic, accessible HTML

---

## PWA Rules (Non-Negotiable)

Do NOT break or remove:

- `manifest.json`
- service worker registration
- required meta tags
- icons or theme colors

Additional rules:

- No changes that reduce Lighthouse PWA compliance
- Use modern, standards-based PWA patterns only

---

## Mandatory Post-Change Verification

After **any** code change:

1. Run `npm run check`
2. Fix **all** errors and warnings
3. Run `npm run lint`
4. Fix **all** errors and warnings
5. Run `npx eslint`
6. Fix **all** eslint errors and warnings

Never ignore, suppress, downgrade, or bypass errors or warnings.

All changes must be **CI-clean by default**.

If checks or lint fail and the fix is unclear:
**STOP and ask instead of guessing.**

---

## Design System — Approved Colors Only

The following colors are the **only colors allowed** in this project:

- `#F68A2E` — primary orange
- `#2C507B` — primary blue
- `#1FA8DB` — accent blue
- `#8BC12D` — accent green
- `#8F3D91` — accent purple

Do not introduce new colors, shades, or CSS variables outside this palette.
