# Contributing Guidelines

These rules are **mandatory** and enforced by local hooks and CI.
Any violation will result in a **failing build**.

This repository is a **Svelte 5 + PWA-first codebase** with a controlled,
file-by-file migration from Svelte 4.

---

## General Rules

- All changes must start from and end in a **passing** `npm run check` state
- Do not commit partial, broken, or half-migrated changes
- Never mix Svelte 4 and Svelte 5 syntax in the same file
- Follow repository documentation exactly — CI is the source of truth

If something is unclear:
**STOP and ask before committing.**

---

## Svelte Rules

- **Target version:** Svelte 5
- **Runes-based reactivity only**
  - `$state`
  - `$derived`
  - `$effect`
- New code must always use Svelte 5 patterns

### Forbidden (All Files)

- `svelte/store`
- `$:` reactive statements
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-based component instantiation

### Migration Rules

- Legacy Svelte 4 files must include:
  ```svelte
  <!-- MIGRATION: SVELTE4-LEGACY -->
  ```
- Legacy files:
  - Bug fixes only
  - No new features
  - No opportunistic refactors
- Migrated files:
  - Use runes exclusively
  - Contain **no legacy syntax**
  - Represent the final architectural state

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)** exclusively
- ❌ No XHTML or XML-style syntax
- ❌ No deprecated elements or attributes
- Use semantic, accessible markup
- Do not change markup semantics during logic-only changes

---

## PWA Rules

This is a **Progressive Web App**.

Do not break or remove:

- `manifest.json`
- Service worker registration
- Offline or caching behavior
- Required meta tags, icons, or theme colors

All changes must preserve installability and Lighthouse PWA compliance.

---

## Verification (Required)

Before committing **any** change:

1. Run `npm run check`
2. Fix **all** errors and warnings
3. Run `npm run lint`
4. Fix **all** errors and warnings
5. Run `npx eslint`
6. Fix **all** eslint errors and warnings

❌ Never suppress, ignore, or downgrade failures  
✅ All commits must be CI-clean by default

---

## Required Reading

You must read and follow:

- `README.md`
- `AI_GUARD.md`
- `ARCHITECTURE.md`
- `MIGRATION.md`
- `PWA.md`
- `HTML_LIVING_STANDARD.md`

If there is any conflict, **CI enforcement wins**.
