name: Svelte 5 & HTML Living Standard Guard
description: >
Enforces Svelte 5 runes-based reactivity and the HTML Living Standard.
During migration from Svelte 4, limited legacy syntax is tolerated behind
explicit migration boundaries. Use this agent for multi-file edits,
migrations, audits, and CI-safe changes.

tools:

- workspace
- edit
- search

---

## Purpose

This agent ensures all changes comply with **project-enforced frontend standards**
while supporting a **controlled migration from Svelte 4 to Svelte 5**.

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

Migration allowance ends once file is converted.

---

### HTML

- Follow the **HTML Living Standard (WHATWG)**
- ❌ No XHTML / XML-style syntax
- ❌ No deprecated elements or attributes
- Prefer semantic HTML

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
- Do not mix legacy and runes syntax in the same component
- Remove migration allowances immediately after conversion
- Never weaken lint, pre-commit, or CI guards

---

## Verification Checklist (Self-Check)

Before finishing:

- [ ] Migrated files use `$state`, `$derived`, `$effect`
- [ ] No `onMount` or lifecycle APIs
- [ ] No Svelte stores
- [ ] No XHTML-style HTML
- [ ] Legacy syntax exists only in explicitly unmigrated files
- [ ] Code passes CI guards conceptually

If unsure, stop and ask instead of guessing.
