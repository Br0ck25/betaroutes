# Svelte 4 → Svelte 5 Migration Agent Specification
## Version 2.7.3 (Minor Clarifications – Supersedes v2.7.2 and all prior versions)

This document is the **single source of truth** for migrating this repository
from Svelte 4 to Svelte 5.

If any other document, tool, or instruction conflicts with this file,
**this specification wins**. CI enforcement follows this hierarchy.

---

## Core Principles (Non-Negotiable)

- Migration is **file-by-file**
- A file must be **either** Svelte 4 **or** Svelte 5 — never both
- Partial migrations are forbidden
- CI must be **clean at all times**
- **PWA behavior must remain intact**
- Structural refactors are **not allowed** during migration
- When in doubt: **STOP and ask**

---

## Definition: PWA Behavior

For the purposes of migration verification, **PWA behavior intact** means:

- Service worker still registers successfully
- Application loads and functions offline (where previously supported)
- `manifest.json` remains valid and unchanged
- App remains installable (no regression in install prompt behavior)

Full Lighthouse audits are **not required**, but obvious regressions are forbidden.

---

## Repo Scan & Migration Order (Required)

Before any migration work begins:

1. Run `npm run migrate:order`
   - If this script does not exist, it **must be created before migration begins**
   - If the script exists but fails to run, migration must **STOP and be escalated**
2. Review the generated `MIGRATION_ORDER.md`
3. Use this file as the **only approved migration order**
4. Check off files **only after successful migration**

Manual reordering is forbidden unless a dependency cycle or error is discovered,
in which case migration must STOP and be escalated to a human maintainer.

---

## VS Code Chat Operating Mode (Strict)

When used in VS Code / GitHub Copilot Chat:

- Operate on **one file at a time**
- Modify **only the currently open file**
- Do NOT scan or rewrite the repository
- Do NOT refactor unrelated files
- Output **final migrated file only**
- No explanations unless migration cannot proceed

---

## Rate-Limit–Aware Output Rules

To prevent Copilot throttling:

- Single-pass migration only
- No retries unless blocked
- No repeated edits to the same file
- No verbose reasoning or commentary
- Avoid token-heavy analysis

---

## Forbidden Tooling (Absolute)

The following tools must **never** be used:

- `npx sv migrate svelte-5`
- Any automated codemods
- Bulk or repo-wide migration scripts
- Third-party migration generators

All migration must follow this spec exactly.

---

## File States

Every `.svelte` file must be in exactly one state.

### 1. Legacy File — Svelte 4

Must include at the very top:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

Allowed:
- Existing legacy syntax
- Bug fixes only

Disallowed:
- New features
- Architectural refactors
- Dependency direction changes

Legacy files MAY temporarily contain:
- `svelte/store`
- lifecycle hooks
- `createEventDispatcher`

These MUST be removed **before migration** in a **separate cleanup commit**.
Cleanup commits must occur **immediately before** the migration commit
and may be part of the same PR, but must never be squashed together.

---

### 2. Migrated File — Svelte 5

Characteristics:
- No migration marker
- Runes-based reactivity only
- Final architectural form

Required:
- `$state`, `$derived`, `$effect`
- Props via `$props()`
- DOM events via standard attributes (`onclick`)
- Snippets + `{@render}` (no `<slot>`)

#### Required Snippet Patterns

- Default content:
  ```svelte
  {@render children?.()}
  ```

- Named content:
  ```svelte
  {@render footer?.()}
  ```

- Snippet definition:
  ```svelte
  {#snippet footer()}
    <footer>...</footer>
  {/snippet}
  ```

- Snippet with props:
  ```svelte
  {#snippet item(data)}
    <li>{data.name}</li>
  {/snippet}

  {@render item(someData)}
  ```

Forbidden:
- Any legacy syntax
- Stores
- Lifecycle APIs
- Dispatchers
- `<slot>` elements

---

## Dependency Order (Strict)

Migration must follow dependency order:

1. Leaf components (no component imports)
2. Shared components
3. Layouts
4. Pages

Rules:
- Svelte 5 components MAY import legacy components
- Legacy components MUST NOT import Svelte 5 components

Circular dependencies must **not** be migrated.
Discovery of a cycle requires escalation and a separate refactor plan.

---

## Pre-Migration Cleanup Phase (Required)

If a legacy file contains:
- stores
- lifecycle hooks
- dispatchers
- Svelte-dependent utilities

You MUST:
1. Refactor to remove these using Svelte 4 patterns
2. Keep the legacy marker
3. Commit cleanup separately
4. Only then migrate to Svelte 5

---

## Migration Checklist (Mandatory)

1. Confirm file is next in `MIGRATION_ORDER.md`
2. Ensure file is CI-clean pre-change
3. Convert state to `$state`
4. Convert derived values to `$derived`
5. Replace side effects with `$effect`
6. Replace `export let` with `$props()`
7. Replace `on:event` with DOM attributes
8. Replace slots with snippets
9. Remove migration marker
10. Run:
    - `npm run check`
    - `npm run lint`
    - `npx eslint`
11. Run `npm test` **if tests exist**
12. Manual verification:
    - Component renders without errors
    - Interactive elements function correctly
    - No console errors or warnings
    - Props and callbacks work as expected
13. Commit only if **all checks pass with zero warnings**

---

## CI-Clean Definition

CI-clean means:
- Zero errors
- Zero warnings
- No suppressed rules
- No ignored failures

---

## TypeScript Migration Rules

- Props are typed via `$props<{ ... }>()`
- Default values defined in destructuring
- Do NOT use `export let` for typing
- Generic components must be explicitly typed

---

## Edge Cases

### Mixed Imports
- Svelte 5 → legacy imports allowed
- Legacy → Svelte 5 imports forbidden

### Cross-Component Communication
- Callback props only
- No dispatchers at any stage

### Shared Utilities
- Must be framework-agnostic
- Svelte-dependent utilities require pre-cleanup

---

## Verification Beyond CI

Required:
- Manual browser smoke test

Conditional:
- Accessibility verification if markup or ARIA changes

Not required:
- Visual regression tooling
- Bundle size tracking

---

## Final Architecture Definition

Migration includes:
- Syntax conversion
- Pattern alignment

Migration does NOT include:
- Structural refactors
- Component responsibility changes

These require separate refactor commits.

---

## Rollback Procedure

If a migrated file causes issues post-merge:

1. Revert the migration commit
2. Restore legacy marker
3. Document issue in `MIGRATION_NOTES.md`
4. Fix root cause
5. Re-attempt migration

Skipping files is forbidden.

---

## Commit Metadata

Recommended commit format:
```
migrate(svelte5): ComponentName
```

---

## Completion Criteria

Migration is complete when:
- No legacy markers remain
- All components use Svelte 5 runes
- CI passes cleanly
- PWA behavior is verified

---

This specification is enforced by CI, pre-commit hooks, AI_GUARD.md,
and supersedes all prior migration instructions.
