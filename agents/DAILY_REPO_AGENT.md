# Everyday Repository Agent — SvelteKit + Svelte 5

> **Purpose**
> This file defines the **default AI agent behavior** for all day-to-day work in this repository:
> edits, new files, deletions, refactors, pages, components, and utilities.
>
> This agent is **not** responsible for planning migrations.
> Migration work is governed separately by `MIGRATION.md`.

---

## Agent Scope

Use this agent when the user wants to:

- Edit existing code
- Add new components, routes, or pages
- Create new utilities or helpers
- Delete or reorganize files
- Perform refactors **within existing architecture**
- Make UI, logic, or performance improvements
- Fix bugs
- Add documentation

Do **NOT** use this agent to:
- Plan migration order
- Convert multiple files across Svelte versions
- Override repository governance
- Bypass CI or linting rules

---

## Authority & Precedence (Non‑Negotiable)

This agent **enforces** but does not redefine rules.

If there is a conflict, precedence is:

1. CI enforcement
2. `AI_GUARD.md`
3. `REPOSITORY_GOVERNANCE.md`
4. `MIGRATION.md`
5. `ARCHITECTURE.md`
6. `HTML_LIVING_STANDARD.md`
7. `PWA.md`
8. This agent file

If unsure, **STOP and ask**.

---

## Repository Context

- Framework: **SvelteKit**
- Svelte Version: **Svelte 5**
- Migration State: **Mixed Svelte 4 / Svelte 5**
- Architecture: Runes-based, component-local state
- App Type: **Progressive Web App (PWA)**

---

## Svelte Rules (Everyday Work)

### Default Rule
All **new code** must be **Svelte 5 only**.

### Required
- `$state` for mutable state
- `$derived` for computed values
- `$effect` for side effects
- `$props()` for props
- Standard DOM events (`onclick`, etc.)
- Callback props for component communication
- Snippets + `{@render}` instead of slots

### Forbidden (All Files)
- `svelte/store`
- `$:` reactive labels
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`
- Class-based component instantiation
- React-style hooks or patterns

### Legacy Exception
Only files explicitly marked with:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

may contain Svelte 4 syntax.
Never introduce new legacy code.

---

## HTML Rules

- Follow the **HTML Living Standard (WHATWG)**
- No XHTML / XML-style syntax
- No deprecated elements or attributes
- Prefer semantic and accessible HTML
- Lowercase tags and attributes
- No self-closing non-void elements

---

## PWA Rules (Always Enforced)

Do NOT break or remove:
- `manifest.json`
- service worker registration
- offline caching behavior
- icons or theme colors

Rules:
- No regressions in Lighthouse PWA score
- No removal of required meta tags
- No breaking changes to offline functionality

---

## Design System Constraints

Only the following colors are allowed:

- `#F68A2E` — primary orange
- `#2C507B` — primary blue
- `#1FA8DB` — accent blue
- `#8BC12D` — accent green
- `#8F3D91` — accent purple

Do not introduce new colors, shades, or CSS variables.

---

## File Creation Rules

When creating new files:

- Place files in the correct existing directory
- Match naming conventions already in use
- Prefer small, focused files
- Do not introduce new architectural layers
- Do not create framework-agnostic abstractions

---

## Deletions & Refactors

- Do not delete files without confirming no remaining references
- Do not refactor unrelated code
- Keep diffs minimal and scoped
- Preserve public APIs unless explicitly instructed

---

## Rate‑Limit & Token Discipline

To avoid Copilot rate limits:

- Work on **one file at a time**
- Do not reprint unchanged files
- Output only the final result
- Avoid commentary unless requested
- Never rescan the repo unless explicitly instructed

---

## Mandatory Verification (Before Final Output)

Before returning a final answer, assume the user will run:

```sh
npm run check
npm run lint
npx eslint
```

All output must be **CI-clean with zero warnings**.

If a fix is unclear:
**STOP and ask instead of guessing.**

---

## Output Rules

- Output **only** what the user requested
- Do not explain changes unless asked
- Do not add speculative improvements
- Do not modify files outside the requested scope

---

## Failure Mode

If requirements conflict, information is missing, or a change would violate governance:
**STOP and ask for clarification.**

This is mandatory.
