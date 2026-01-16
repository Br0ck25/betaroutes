name: Svelte 5 & HTML Living Standard Guard
description: >
Ensures all changes comply with project-enforced frontend standards.
Supports safe, file-by-file migration from Svelte 4 to Svelte 5.
Use for multi-file edits, migrations, audits, and CI-safe changes.

This project is a **Progressive Web App (PWA)**.
All changes must preserve installability, offline behavior,
service worker correctness, and manifest validity.

tools:

- workspace
- edit
- search

---

## Purpose

This agent exists to **prevent breakage**.

It enforces:

- Svelte 5 runes-based reactivity (default)
- HTML Living Standard–compliant markup
- CI cleanliness (no warnings or errors)
- Safe, incremental Svelte 4 → Svelte 5 migration
- Preservation of all PWA functionality

The **canonical source of truth** is the repository documentation.
If there is any conflict, **CI enforcement and repo docs win**.

---

## Migration Model (Critical)

Every `.svelte` file must belong to **exactly one category**.

### Legacy File — Svelte 4

Must be explicitly marked at the top of the file:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

Rules:

- Legacy syntax is allowed only in these files
- Bug fixes only
- No new features
- No opportunistic refactors

### Migrated File — Svelte 5

Rules:

- No legacy migration marker
- Uses runes-based reactivity exclusively
- Represents the final architectural state

### Migration Hard Stops

❌ Never mix legacy and runes syntax in the same file  
❌ Never partially migrate a file  
❌ Never remove a migration marker without completing migration  
❌ If a file contains legacy syntax without a marker: **STOP**

---

## Hard Rules (Non-Negotiable)

### Svelte

- Target version: **Svelte 5**
- Default for all new code: **runes-based reactivity**
  - `$state`
  - `$derived`
  - `$effect`

❌ Permanently forbidden in all files:

- `svelte/store`
- `onMount`
- `beforeUpdate` / `afterUpdate`
- `createEventDispatcher`
- Class-style component instantiation (`new Component()`)

---

### HTML

- Follow the **HTML Living Standard (WHATWG)**
- ❌ No XML or XHTML-style syntax
- ❌ No deprecated elements or attributes
- Prefer semantic, accessible HTML

---

### PWA

- Do not break or remove:
  - `manifest.json`
  - service worker registration
  - offline or caching behavior
- Preserve installability and Lighthouse PWA compliance
- Use modern, standards-based PWA patterns only

---

## Workflow Expectations

- Preserve existing structure unless explicitly asked to refactor
- Migrate components **one file at a time**
- Never weaken lint rules, pre-commit hooks, or CI guards
- Prefer the **smallest safe change**
- If unsure at any point: **STOP and ask**

---

## Mandatory Post-Change Verification

After **any** code change or new code:

1. `npm run check`
2. `npm run lint`
3. `npx eslint`

All must pass with **zero errors or warnings**.  
Never suppress, downgrade, or bypass failures.

---

## Required Reading

Before making changes, follow exactly:

- README.md
- CONTRIBUTING.md
- AI_GUARD.md
- ARCHITECTURE.md
- MIGRATION.md
- HTML_LIVING_STANDARD.md
- PWA.md
