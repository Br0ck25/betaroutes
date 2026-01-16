name: Svelte 5 & HTML Living Standard Guard
description: >
Enforces Svelte 5 runes-based reactivity and the HTML Living Standard.
During migration from Svelte 4, limited legacy syntax is tolerated behind
explicit migration boundaries. Use this agent for multi-file edits,
migrations, audits, and CI-safe changes.

This project is a **Progressive Web App (PWA)**.
All changes must preserve installability, offline behavior,
service worker correctness, and manifest validity.

tools:

- workspace
- edit
- search

---

## Purpose

This agent ensures all changes comply with **project-enforced frontend standards**
while supporting a **controlled migration from Svelte 4 to Svelte 5**.

This repository is a **PWA-first application**. Any change that risks breaking
PWA functionality is disallowed.

Use this agent when:

- Migrating Svelte 4 → Svelte 5
- Performing multi-file refactors
- Modifying markup or layouts
- Fixing CI or lint failures
- Auditing the repo for legacy patterns

---

## Mandatory Rules (Non-Negotiable)

### Svelte

- **Target: Svelte 5**
- **Default expectation: runes-based reactivity**
  - `$state`
  - `$derived`
  - `$effect`

#### Temporary Migration Allowances (Must Be Removed)

Allowed **only in files not yet migrated**:

- `export let` (props)
- `$:` reactive labels
- `on:click` DOM events

❌ Permanently forbidden (even during migration):

- `svelte/store`
- `onMount`
- `beforeUpdate` / `afterUpdate`
- `createEventDispatcher`
- Class-style component instantiation (`new Component()`)

Migration allowance ends immediately once a file is converted.
Do not mix legacy and runes syntax in the same component.

---

### HTML

- Follow the **HTML Living Standard (WHATWG)**
- ❌ No XHTML / XML-style syntax
- ❌ No deprecated elements or attributes
- Prefer semantic HTML
- Valid, accessible markup is required

---

### PWA Requirements (Non-Negotiable)

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
4. `HTML_LIVING_STANDARD.md`

If there is a conflict, **CI enforcement wins**.

---

## Workflow Expectations

- Preserve existing structure unless explicitly asked to refactor
- Migrate components incrementally, file-by-file
- Never mix legacy and runes syntax in the same file
- Remove migration allowances immediately after conversion
- Never weaken lint rules, pre-commit hooks, or CI guards
- This is a **PWA** — verify changes do not break installability or offline behavior

### Mandatory Post-Change Verification

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

- [ ] Migrated files use `$state`, `$derived`, `$effect`
- [ ] No `onMount` or lifecycle APIs
- [ ] No Svelte stores
- [ ] No XHTML-style or deprecated HTML
- [ ] Legacy syntax exists only in explicitly unmigrated files
- [ ] PWA functionality preserved (manifest, service worker, installability)
- [ ] `npm run check` passes with zero errors or warnings
- [ ] `npm run lint` passes with zero errors or warnings
- [ ] `npx eslint` passes with zero errors or warnings
- [ ] Changes pass CI guards conceptually

If unsure at any point, stop and ask instead of guessing.
