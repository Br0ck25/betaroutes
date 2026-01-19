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
- Migration order is determined mechanically (see Migration Tooling)

If any rule cannot be followed:
**STOP and ask before proceeding.**

---

## Migration Tooling (Required)

Migration order and progress tracking are handled by **local, non-AI scripts**.

### Generate migration order

```bash
npm run migrate:order
```

This generates `MIGRATION_ORDER.md`, which defines the **only approved file order**.

Rules:
- Migrate files **top-to-bottom**
- Migrate **one file at a time**
- AI tools must **never** edit `MIGRATION_ORDER.md`

### Mark a file as migrated

After successfully migrating and committing a file:

```bash
npm run migrate:done path/to/file.svelte
```

This updates the checklist and records progress.

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

1. Confirm the file is next in `MIGRATION_ORDER.md`
2. Add `<!-- MIGRATION: SVELTE4-LEGACY -->` (if not already present)
3. Ensure the file is CI-clean before changes
4. Convert all state to `$state`
5. Convert derived values to `$derived`
6. Replace lifecycle logic with `$effect`
7. Replace `export let` with `$props()`
8. Replace `on:click` with `onclick`
9. Remove the migration marker
10. Re-run:
    - `npm run check`
    - `npm run lint`
    - `npx eslint`
11. Commit only if **all checks pass with zero warnings**
12. Mark the file complete using `npm run migrate:done`

---

## Hard Stops

❌ Never:
- Migrate files out of order
- Mix Svelte 4 and Svelte 5 syntax in the same file
- Leave a file half-migrated
- Remove a migration marker without completing migration
- Silence lint or CI failures
- Allow AI tools to plan or reorder migration work

If a step is unclear:
**STOP and ask instead of guessing.**

---

## Completion Criteria

A migration is considered complete when:
- No files contain `SVELTE4-LEGACY` markers
- All components use Svelte 5 runes
- `MIGRATION_ORDER.md` has no unchecked entries
- CI passes cleanly
- PWA functionality is verified

---

## Enforcement

These rules are enforced by:
- CI
- Pre-commit hooks
- AI_GUARD.md

Violations will fail the build.
