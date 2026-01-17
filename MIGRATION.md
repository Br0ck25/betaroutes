# Svelte 4 → Svelte 5 Migration Checklist

This document defines the **only approved migration process** for this repository.

The goal is to migrate safely, incrementally, and without breaking CI, PWA behavior,
or architectural guarantees.

---

## Migration Principles (Non-Negotiable)

- Migration is **file-by-file**
- A file must be **either** Svelte 4 **or** Svelte 5 — never both
- Partial or mixed migrations are forbidden
- CI must pass at all times
- PWA behavior must remain intact

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
- `on:click` event directives

Restrictions:

- Bug fixes only
- No new features
- No refactors unless strictly required
- No stylistic changes

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
- Represents the final architectural state

Requirements:

- Use `$state`, `$derived`, `$effect`
- Props via `$props()`
- DOM events via standard attributes (`onclick`)
- Snippets instead of slots

Forbidden:

- Any legacy Svelte 4 syntax
- Any lifecycle APIs
- Any stores

---

## Migration Steps (Checklist)

When migrating a file:

1. Add `<!-- MIGRATION: SVELTE4-LEGACY -->` (if not already present)
2. Ensure the file is CI-clean before changes
3. Convert all state to `$state`
4. Convert derived values to `$derived`
5. Replace lifecycle logic with `$effect`
6. Replace `export let` with `$props()`
7. Replace `on:click` with `onclick`
8. Remove the migration marker
9. Re-run:
   - `npm run check`
   - `npm run lint`
   - `npx eslint`
10. Commit only if **all checks pass with zero warnings**

---

## Hard Stops

❌ Never:

- Mix Svelte 4 and Svelte 5 syntax in the same file
- Leave a file half-migrated
- Remove a migration marker without completing migration
- Silence lint or CI failures

If a step is unclear:
**STOP and ask instead of guessing.**

---

## Completion Criteria

A migration is considered complete when:

- No files contain `SVELTE4-LEGACY` markers
- All components use Svelte 5 runes
- CI passes cleanly
- PWA functionality is verified

---

## Enforcement

These rules are enforced by:

- CI
- Pre-commit hooks
- AI_GUARD.md

Violations will fail the build.
