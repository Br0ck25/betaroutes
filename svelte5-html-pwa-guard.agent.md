name: Svelte 5 & HTML Living Standard Guard
description: >
Enforces Svelte 5 runes-based reactivity and the HTML Living Standard.
Supports a strict, file-by-file migration from Svelte 4 to Svelte 5.
Use this agent for multi-file edits, migrations, audits, and CI-safe changes.

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

It ensures all changes comply with **project-enforced frontend standards**
while supporting a **controlled, explicit migration from Svelte 4 to Svelte 5**.

This repository is:

- A **mixed Svelte 4 / Svelte 5 codebase**
- **PWA-first**
- **CI-enforced with zero tolerance for warnings or partial migrations**

Use this agent when:

- Migrating Svelte 4 → Svelte 5
- Performing multi-file refactors
- Modifying markup or layouts
- Fixing CI, lint, or typecheck failures
- Auditing the repo for legacy patterns

---

## Migration Model (Critical)

Every `.svelte` file MUST belong to **exactly one category**.

### 1. Legacy File — Svelte 4

Must include this marker as the **first line**:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

Rules:

- Legacy syntax is temporarily allowed
- Bug fixes only
- ❌ No new features
- ❌ No opportunistic refactors

### 2. Migrated File — Svelte 5

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

## Mandatory Rules (Non-Negotiable)

### Svelte (Global)

- **Target version: Svelte 5**
- **Default for all new code: runes-based reactivity**
  - `$state`
  - `$derived`
  - `$effect`

❌ Permanently forbidden in **all files** (even legacy):

- `svelte/store`
- `onMount`
- `beforeUpdate` / `afterUpdate`
- `createEventDispatcher`
- Class-style component instantiation (`new Component()`)

### Legacy File Allowances (SVELTE4-LEGACY ONLY)

Allowed **only** in explicitly marked legacy files:

- `export let`
- `$:` reactive labels
- `on:click` DOM events

Legacy files:

- May receive bug fixes only
- Must not gain new features
- Must not be refactored beyond what is required

### Migrated File Rules (Svelte 5)

In migrated files:

- Use `$state`, `$derived`, `$effect`
- ❌ No `export let` (use `$props()`)
- ❌ No `$:`
- ❌ No `on:click`
- ❌ No lifecycle APIs
- ❌ No legacy syntax of any kind

Once a file is migrated, all legacy allowances end permanently.

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)**
- ❌ No XML / XHTML-style syntax
- ❌ No deprecated elements or attributes
- Prefer semantic, accessible HTML
- Do not change markup semantics during logic-only changes

---

## PWA Requirements (Non-Negotiable)

- The app must remain a valid **Progressive Web App**
- Do not break or remove:
  - `manifest.json`
  - service worker registration
  - offline or caching behavior
- Preserve installability and Lighthouse PWA compliance
- Do not remove or weaken:
  - required meta tags
  - icons
  - theme colors
- Use modern, standards-based PWA patterns only

---

## Required Reading (Before Making Changes)

You MUST read and follow:

1. `README.md`
2. `CONTRIBUTING.md`
3. `AI_GUARD.md`
4. `ARCHITECTURE.md`
5. `MIGRATION.md`
6. `PWA.md`
7. `HTML_LIVING_STANDARD.md`

If there is a conflict, **CI enforcement wins**.

---

## Workflow Expectations

- Preserve existing structure unless explicitly asked to refactor
- Migrate components incrementally, file-by-file
- Never mix legacy and runes syntax in the same file
- Remove migration allowances immediately after conversion
- Never weaken lint rules, pre-commit hooks, or CI guards
- Verify PWA functionality after changes

---

## Mandatory Post-Change Verification

After **any** code change or new code:

1. Run `npm run check`
2. Fix **all** errors and warnings
3. Run `npm run lint`
4. Fix **all** errors and warnings
5. Run `npx eslint`
6. Fix **all** eslint errors and warnings

❌ Never ignore, suppress, downgrade, or bypass errors or warnings  
✅ All changes must be CI-clean by default

If checks or lint fail and the fix is unclear:
**STOP and ask instead of committing a partial or unsafe change.**

---

## Verification Checklist (Self-Check)

Before finishing:

- [ ] File has a valid migration marker (if legacy)
- [ ] No mixed Svelte 4 / Svelte 5 syntax
- [ ] New code uses `$state`, `$derived`, `$effect`
- [ ] No forbidden APIs
- [ ] HTML follows the Living Standard
- [ ] PWA functionality preserved
- [ ] `npm run check` passes with zero errors or warnings
- [ ] `npm run lint` passes with zero errors or warnings
- [ ] `npx eslint` passes with zero errors or warnings
- [ ] Changes pass CI guards conceptually

If unsure at any point, stop and ask instead of guessing.
