# AI Guard

These rules are **non-negotiable** and apply to **all AI-generated output**
(including ChatGPT, GitHub Copilot, and other automated tools).

Violations will fail linting, pre-commit hooks, or CI.

This repository is a **Progressive Web App (PWA)** and a
**mixed Svelte 4 / Svelte 5 codebase undergoing controlled migration**.

---

## Absolute Prohibitions

The AI must **never** introduce, reintroduce, or rely on:

### Svelte

- `$:` reactive statements
- `svelte/store` (writable, readable, derived, or custom)
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-based or legacy component instantiation
- Mixing legacy Svelte 4 syntax with Svelte 5 runes in the same file

### HTML

- XML or XHTML syntax
- Self-closing non-void elements
- Deprecated HTML elements or attributes
- Invalid or malformed markup

---

## Required Behavior

The AI must **always**:

### General

- Follow **README.md**, **CONTRIBUTING.md**, **ARCHITECTURE.md**,
  **HTML_LIVING_STANDARD.md**, and this document exactly
- Preserve existing project structure unless explicitly instructed otherwise
- Produce output that is **CI-clean by default**

### Svelte

- Use **Svelte 5 runes-based reactivity exclusively** in migrated files:
  - `$state`
  - `$derived`
  - `$effect`
- Use `$props()` for component props
- Use callback props for component communication
- Use standard DOM event attributes (`onclick`, etc.)
- Write all **new files** as fully migrated Svelte 5 components

### Migration Safety

- Respect file-by-file migration boundaries
- Legacy Svelte 4 syntax is allowed **only** in files explicitly marked as legacy
- Once a file is migrated, **all** legacy syntax must be removed
- Partial or mixed migrations are forbidden

### HTML

- Use **HTML Living Standard (WHATWG)**–compliant markup
- Prefer semantic and accessible HTML
- Write HTML as parsed by browsers, not XML parsers

### PWA

- Preserve installability, offline behavior, and caching
- Do not break or remove:
  - `manifest.json`
  - service worker registration
  - required meta tags, icons, or theme colors
- Do not introduce network-only architectural assumptions

---

## Mandatory Post-Change Verification

For **any** code change or new code, the AI must ensure the final output:

1. Passes `npm run check` with **zero** errors or warnings
2. Passes `npm run lint` with **zero** errors or warnings
3. Passes `npx eslint` with **zero** errors or warnings

❌ Errors or warnings must **not** be ignored, suppressed, or downgraded.

If a failure occurs and the fix is unclear:
**STOP and ask instead of guessing.**

---

## Transitional States

Temporary breakage during reasoning is acceptable.

The **final output must always be fully compliant**.

Partial, transitional, or “almost correct” states are **not acceptable**.

---

## Source of Truth

If there is a conflict between AI output and tooling or CI enforcement:
**CI enforcement wins.**
