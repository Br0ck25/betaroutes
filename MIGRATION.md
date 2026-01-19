# Svelte 4 → Svelte 5 Migration Guide

This document defines the **operational migration process** for this repository.
It MUST be used together with:

- **svelte-4-to-5-migration-agent-spec.v2.6.md** (authoritative rules)
- `MIGRATION_ORDER.md` (mechanically generated order)
- CI and pre-commit enforcement

If any conflict exists, **the migration agent spec wins**.

---

## Migration Principles (Non-Negotiable)

- Migration is **file-by-file**
- A file must be **either** Svelte 4 **or** Svelte 5 — never both
- Partial or mixed migrations are forbidden
- CI must pass at all times
- PWA behavior must remain intact
- **Dependency order is mandatory**
- Migration order is determined mechanically

If any rule cannot be followed:
**STOP and ask before proceeding.**

---

## Migration Authority

The following are binding, in order:

1. **svelte-4-to-5-migration-agent-spec.v2.6.md**
2. `MIGRATION_ORDER.md`
3. CI / pre-commit hooks

This file explains *how to execute* migrations within those constraints.

---

## Migration Tooling (Required)

Migration order and progress tracking are handled by **local, non-AI scripts**.

### Generate migration order

```bash
npm run migrate:order
```

This generates `MIGRATION_ORDER.md`, which defines the **only approved migration order**.

Rules:
- Files MUST be migrated **top-to-bottom**
- **Leaf components first**
- **Shared UI components before pages/layouts**
- **Routes, layouts, and pages last**
- AI tools must **never** edit `MIGRATION_ORDER.md`

---

### Mark a file as migrated

After successfully migrating and committing a file:

```bash
npm run migrate:done path/to/file.svelte
```

This:
- Checks off the file
- Records completion
- Prevents duplicate or skipped work

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
- Represents the final architectural state

Requirements:
- `$state`, `$derived`, `$effect`
- Props via `$props()`
- DOM events via standard attributes (`onclick`)
- Snippets instead of slots

Forbidden:
- Any legacy Svelte 4 syntax
- Any lifecycle APIs
- Any stores

---

## Pre-Migration Requirements

Before migrating a file:

### If the file uses `svelte/store`
- Refactor to component-local state **in Svelte 4**
- Keep the `SVELTE4-LEGACY` marker
- Commit separately
- **Do NOT introduce Svelte 5 syntax**

### If the file uses lifecycle hooks or `createEventDispatcher`
- Refactor them out using Svelte 4 patterns
- Keep the `SVELTE4-LEGACY` marker
- Commit separately

🚫 Cleanup commits MUST NOT contain Svelte 5 runes.

---

## Migration Steps (Required Order)

1. Confirm the file is next in `MIGRATION_ORDER.md`
2. Ensure the file is CI-clean
3. Convert all state to `$state`
4. Convert derived values to `$derived`
5. Replace lifecycle logic with `$effect`
6. Replace `export let` with `$props()`
7. Replace `on:click` with `onclick`
8. Remove the migration marker
9. Run:
   - `npm run check`
   - `npm run lint`
   - `npx eslint`
10. Run `npm test` and verify all tests pass
11. Manually verify the component renders and behaves correctly
12. Commit **only if all checks pass with zero warnings**
13. Mark the file complete:
   ```bash
   npm run migrate:done path/to/file.svelte
   ```

---

## Rollback Procedure

If a migrated file causes runtime or behavioral issues:

1. Immediately revert the migration commit
2. Re-add the `<!-- MIGRATION: SVELTE4-LEGACY -->` marker
3. Document the issue in `MIGRATION_NOTES.md`
4. Fix the underlying problem
5. Re-attempt migration — **do NOT skip the file**

---

## Hard Stops

❌ Never:

- Migrate files out of order
- Ignore dependency direction
- Mix Svelte 4 and Svelte 5 syntax in the same file
- Leave a file half-migrated
- Remove a migration marker prematurely
- Silence lint, test, or CI failures
- Use automated migration tools
- Allow AI tools to plan or reorder migration work

If unsure:
**STOP and ask instead of guessing.**

---

## Completion Criteria

The migration is complete when:

- No files contain `SVELTE4-LEGACY` markers
- All components use Svelte 5 runes
- `MIGRATION_ORDER.md` is fully checked
- CI passes cleanly
- PWA functionality is verified

---

## Enforcement

These rules are enforced by:
- CI
- Pre-commit hooks
- AI_GUARD.md

Violations will fail the build.
