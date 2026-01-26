# Repository Governance

This document defines **repository-wide governance rules**.

This repository **enforces Svelte 5 runes-based reactivity and the HTML Living Standard**.
It is a **mixed Svelte 4 / Svelte 5 codebase** with a controlled, file-by-file migration.

Legacy syntax is allowed **only** in files explicitly marked with `<!-- MIGRATION: SVELTE4-LEGACY -->`.
Mixing legacy and runes syntax in the same file will fail CI.

This is a **Progressive Web App (PWA)**.

---

## Mandatory Reading (Before Any Changes)

You MUST read and follow:

- `README.md`
- `CONTRIBUTING.md`
- `AI_GUARD.md`
- `HTML_LIVING_STANDARD.md`

If migrating files, also read:

- `svelte-4-to-5-migration-agent-spec.v2.7.3.md` (authoritative)
- `MIGRATION.md` (operational guidance)

If there is a conflict, **the migration spec and CI enforcement win**.

---

## Svelte Rules (Strict)

**Target:** Svelte 5

**All new code must use runes-based reactivity:**

- `$state`
- `$derived`
- `$effect`

**File State Rules:**

- Do not mix legacy and runes syntax in the same file
- Files must clearly belong to either:
  - **Svelte 4 (legacy)** with marker, or
  - **Svelte 5 (migrated)** without marker

### Forbidden in Svelte 5 Files

See `AI_GUARD.md` for the complete authoritative list:

- `svelte/store`
- `$:` reactive statements
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-based component instantiation

### Legacy Files (Temporary)

Files marked `<!-- MIGRATION: SVELTE4-LEGACY -->` may temporarily contain forbidden patterns until pre-migration cleanup is performed. See `MIGRATION.md`.

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)**
- No XHTML / XML-style syntax
- No deprecated elements or attributes
- Prefer semantic, accessible HTML

See `HTML_LIVING_STANDARD.md` for complete rules.

---

## PWA Rules (Non-Negotiable)

Do NOT break or remove:

- `manifest.json`
- Service worker registration
- Required meta tags
- Icons
- Theme colors

Additional rules:

- No changes that reduce PWA functionality
- Use modern, standards-based PWA patterns only

See `PWA.md` for complete requirements.

---

## Mandatory Post-Change Verification

After **any** code change:

1. Run `npm run check`
2. Fix **all** errors and warnings
3. Run `npm run lint`
4. Fix **all** errors and warnings
5. Run `npx eslint`
6. Fix **all** eslint errors and warnings

Optional but recommended: 7. Run `npm test`

Never ignore, suppress, downgrade, or bypass errors or warnings.

All changes must be **CI-clean by default**.

If checks or lint fail and the fix is unclear:
**STOP and ask instead of guessing.**

---

## Design System

See `DESIGN_SYSTEM.md` for approved color palette and design guidelines.
