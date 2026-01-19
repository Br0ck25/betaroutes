# Svelte 4 → Svelte 5 Migration Guide

This document provides **operational migration guidance** for this repository.

**AUTHORITATIVE RULES:** `svelte-4-to-5-migration-agent-spec.v2.7.3.md`

This guide explains how to execute migrations within the constraints defined by the spec.

If any conflict exists, **the migration spec wins**.

---

## Migration Principles (Non-Negotiable)

- Migration is **file-by-file**
- A file must be **either** Svelte 4 **or** Svelte 5 — never both
- Partial or mixed migrations are forbidden
- CI must pass at all times
- PWA behavior must remain intact (see `PWA.md`)
- **Dependency order is mandatory**
- Migration order is determined mechanically

If any rule cannot be followed:
**STOP and ask before proceeding.**

---

## Migration Authority

The following are binding, in order of precedence:

1. **svelte-4-to-5-migration-agent-spec.v2.7.3.md** (authoritative)
2. `MIGRATION_ORDER.md` (generated order)
3. CI / pre-commit hooks
4. This file (operational guidance)

---

## Migration Tooling

### Generate migration order

```bash
npm run migrate:order
```

This generates `MIGRATION_ORDER.md`, which defines the **only approved migration order**.

If this script does not exist, it must be created before migration begins.

Rules:

- Files MUST be migrated in the order specified
- **Leaf components first**
- **Shared UI components before pages/layouts**
- **Routes, layouts, and pages last**
- Manual reordering is forbidden unless a dependency cycle is discovered

---

### Track migration progress

After successfully migrating and committing a file, mark it complete in `MIGRATION_ORDER.md` by checking the box next to the filename.

---

## File States

Every `.svelte` file must belong to exactly one state.

### 1. Legacy File — Svelte 4

Must include this marker at the **very top** of the file:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

**Allowed:**

- Existing legacy syntax that was present before migration began
- Bug fixes only

**Restrictions:**

- No new features
- No stylistic refactors
- No architectural changes

**Temporarily Permitted (until pre-migration cleanup):**

Legacy files discovered during migration inventory may contain:

- `svelte/store`
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`

These MUST be removed in a **pre-migration cleanup commit** (see below) before the file can be migrated to Svelte 5.

---

### 2. Migrated File — Svelte 5

Characteristics:

- **No migration marker**
- Uses runes-based reactivity exclusively
- Represents the final architectural state

**Requirements:**

- `$state`, `$derived`, `$effect`
- Props via `$props()`
- DOM events via standard attributes (`onclick`)
- Snippets instead of slots

**Forbidden:**

- Any legacy Svelte 4 syntax
- Lifecycle APIs
- Stores
- Event dispatchers

See `EXAMPLES.md` for canonical patterns.

---

## Pre-Migration Cleanup Phase

If a legacy file contains forbidden patterns (stores, lifecycle hooks, dispatchers, or Svelte-dependent utilities), you MUST clean them up before migration.

### Cleanup Process:

1. Refactor to remove forbidden patterns using **Svelte 4 syntax only**
2. Keep the `SVELTE4-LEGACY` marker during cleanup
3. Commit cleanup separately with message: `cleanup(svelte4): ComponentName - remove [pattern]`
4. Verify CI passes
5. Only then proceed with Svelte 5 migration

**Important:** Cleanup commits MUST NOT introduce Svelte 5 syntax. They are Svelte 4 → Svelte 4 refactors only.

---

## Migration Steps (Required Order)

1. Confirm the file is next in `MIGRATION_ORDER.md`
2. Ensure the file is CI-clean pre-change
3. Perform pre-migration cleanup if needed (separate commit)
4. Convert all state to `$state`
5. Convert derived values to `$derived`
6. Replace lifecycle logic with `$effect`
7. Replace `export let` with `$props()`
8. Replace `on:event` with standard DOM attributes
9. Replace slots with snippets
10. Remove the migration marker
11. Run:
    - `npm run check`
    - `npm run lint`
    - `npx eslint`
12. Run `npm test` **if tests exist** (optional but recommended)
13. Manually verify the component renders and behaves correctly
14. Commit **only if all checks pass with zero warnings**
    - Use format: `migrate(svelte5): ComponentName`
15. Check off the file in `MIGRATION_ORDER.md`

---

## Rollback Procedure

If a migrated file causes runtime or behavioral issues discovered after merge:

1. Immediately revert the migration commit
2. Re-add the `<!-- MIGRATION: SVELTE4-LEGACY -->` marker
3. Document the issue in `MIGRATION_NOTES.md` (create if doesn't exist)
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
- Use `npx sv migrate svelte-5` or other automated tools
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
- PWA functionality is verified (see `PWA.md`)

---

## Enforcement

These rules are enforced by:

- The migration spec (`svelte-4-to-5-migration-agent-spec.v2.7.3.md`)
- CI checks
- Pre-commit hooks (when configured)
- `AI_GUARD.md`

Violations will fail the build.
