# Svelte 4 → Svelte 5 Migration Agent Specification — v2.5

This document defines the **only approved migration process** for migrating this repository
from **Svelte 4 to Svelte 5**.

This spec is **strict, enforceable, and CI-governed**.

---

## Core Principles (Non-Negotiable)

- Migration is **file-by-file**
- A file must be **either** Svelte 4 **or** Svelte 5 — never both
- Partial or mixed migrations are forbidden
- CI must pass at all times
- PWA behavior must remain intact
- **Automation tools must NOT perform migrations**

If any rule cannot be followed:
**STOP and ask before proceeding.**

---

## File Categories

Every `.svelte` file must belong to exactly one category.

### 1. Legacy File — Svelte 4

Must include this marker at the **very top** of the file:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

Allowed:
- `export let`
- `$:` reactive labels
- `on:click` directives

Restrictions:
- Bug fixes only
- No new features
- No stylistic refactors

Forbidden (even in legacy):
- `svelte/store`
- `onMount`
- `beforeUpdate` / `afterUpdate`
- `createEventDispatcher`
- Class-based component instantiation

---

### 2. Migrated File — Svelte 5

Characteristics:
- **No migration marker**
- Uses runes-based reactivity exclusively

Requirements:
- `$state`, `$derived`, `$effect`
- Props via `$props()`
- DOM events via standard attributes
- Snippets instead of slots

Forbidden:
- Any legacy Svelte 4 syntax
- Any lifecycle APIs
- Any stores

---

## Pre-Migration Requirements (Mandatory)

Before migrating a file:

### If the file uses `svelte/store`:
- Refactor to component-local state
- Keep `SVELTE4-LEGACY` marker
- **Do NOT introduce Svelte 5 syntax**
- Commit separately

### If the file uses lifecycle hooks or `createEventDispatcher`:
- Refactor to remove them using Svelte 4 patterns
- Keep `SVELTE4-LEGACY` marker
- Commit separately

🚫 Cleanup commits MUST NOT contain Svelte 5 runes.

---

## Migration Checklist (Required Order)

1. Ensure file is CI-clean
2. Convert all state to `$state`
3. Convert derived values to `$derived`
4. Replace lifecycle logic with `$effect`
5. Replace `export let` with `$props()`
6. Replace `on:click` with `onclick`
7. Remove migration marker
8. Run:
   - `npm run check`
   - `npm run lint`
   - `npx eslint`
9. Run `npm test` and verify all tests pass
10. Manually verify component renders and behaves correctly
11. Commit **only if all checks pass with zero warnings**

---

## Rollback Procedure

If runtime issues are discovered post-merge:

1. Immediately revert the migration commit
2. Re-add the `SVELTE4-LEGACY` marker
3. Document the issue in `MIGRATION_NOTES.md`
4. Fix the issue before re-attempting
5. Do NOT skip the file

---

## Forbidden Tooling

🚫 NEVER use:
- `npx sv migrate svelte-5`
- Codemods
- Automated migration scripts

All migrations are **manual and reviewed**.

---

## Appendix: Migration Pattern Reference

| Svelte 4 | Svelte 5 |
|---------|----------|
| `export let foo` | `let { foo } = $props()` |
| `$: bar = foo * 2` | `let bar = $derived(foo * 2)` |
| `$: { sideEffect() }` | `$effect(() => { sideEffect() })` |
| `on:click={handler}` | `onclick={handler}` |
| `<slot />` | `{@render children?.()}` |

---

## Enforcement

Violations are enforced by:
- CI
- Pre-commit hooks
- AI_GUARD.md
