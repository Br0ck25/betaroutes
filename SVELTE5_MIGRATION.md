# Svelte 5 Migration Guide

This document provides a comprehensive migration plan for converting the codebase from Svelte 4 patterns to Svelte 5 runes syntax. The goal is to ensure no legacy code remains after migration.

## Current State Summary

- **Svelte Version**: `^5.0.0` (already on Svelte 5)
- **Total Svelte Files**: 73 files
- **Files Already Using Runes**: 7 files (fully migrated)
- **Files Needing Migration**: 66 files

## Migration Patterns Reference

### 1. Props Migration

```svelte
// BEFORE (Svelte 4)
export let name = 'default';
export let count: number;

// AFTER (Svelte 5)
let { name = 'default', count }: { name?: string; count: number } = $props();
```

### 2. Event Handlers Migration

```svelte
// BEFORE (Svelte 4)
<button on:click={handleClick}>

// AFTER (Svelte 5)
<button onclick={handleClick}>
```

### 3. Reactive Statements Migration

```svelte
// BEFORE (Svelte 4)
$: doubled = count * 2;
$: if (count > 10) console.log('High!');

// AFTER (Svelte 5)
const doubled = $derived(count * 2);
$effect(() => { if (count > 10) console.log('High!'); });
```

### 4. Event Dispatchers Migration

```svelte
// BEFORE (Svelte 4)
import { createEventDispatcher } from 'svelte';
const dispatch = createEventDispatcher();
dispatch('save', data);

// AFTER (Svelte 5)
let { onSave }: { onSave?: (data: DataType) => void } = $props();
onSave?.(data);
```

### 5. Slots to Snippets Migration

```svelte
// BEFORE (Svelte 4)
<slot />
<slot name="header" />

// AFTER (Svelte 5)
{@render children?.()}
{@render header?.()}

// Props declaration
let { children, header }: { children?: Snippet; header?: Snippet } = $props();
```

### 6. Store Usage in Components

```svelte
// Stores still work with $store syntax in Svelte 5 // The $ prefix auto-subscribes to the store
import {auth} from '$lib/stores/auth'; // Use directly with $ prefix in templates: {$auth.user}
```

---

## Migration Order (Recommended Sequence)

Files are ordered from **simplest** (fewer dependencies, leaf components) to **most complex** (layout files, pages with many dependencies).

### Phase 1: UI Primitives (No Dependencies) ✅ COMPLETED

_These are leaf components with minimal complexity. Start here._

| Priority | File                                              | Changes Needed                                                           |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 1        | `src/lib/components/ui/Skeleton.svelte` ✅        | `export let` → `$props()`                                                |
| 2        | `src/lib/components/ui/Input.svelte` ✅           | `export let` → `$props()`                                                |
| 3        | `src/lib/components/ui/Card.svelte` ✅            | None (check for slots)                                                   |
| 4        | `src/lib/components/Loading.svelte` ✅            | `export let` → `$props()`                                                |
| 5        | `src/lib/components/TripSkeleton.svelte` ✅       | None (simple component)                                                  |
| 6        | `src/lib/components/ui/Button.svelte` ✅          | `export let` → `$props()`, `on:click` → `onclick`                        |
| 7        | `src/lib/components/ui/CollapsibleCard.svelte` ✅ | `export let` → `$props()`, `on:click` → `onclick`                        |
| 8        | `src/lib/components/ui/SelectMobile.svelte` ✅    | `export let` → `$props()`, `on:change` → `onchange`, dispatch → callback |
| 9        | `src/lib/components/ui/ToastContainer.svelte` ✅  | `on:click` → `onclick`                                                   |

### Phase 2: Simple Library Components

_These have minimal business logic and few external dependencies._

| Priority | File                                           | Changes Needed                                          |
| -------- | ---------------------------------------------- | ------------------------------------------------------- |
| 10       | `src/lib/components/PWAInstall.svelte`         | dispatch → callback, `on:click` → `onclick`             |
| 11       | `src/lib/components/SyncIndicator.svelte`      | `on:click` → `onclick`                                  |
| 12       | `src/lib/components/AsyncErrorBoundary.svelte` | `export let` → `$props()`, state variables → `$state()` |
| 13       | `src/lib/components/data/ExportView.svelte`    | `$:` → `$derived/$effect`, `on:*` → native              |
| 14       | `src/lib/components/data/ImportView.svelte`    | `on:*` → native                                         |

### Phase 3: Trip Components

_Core business logic components for trips._

| Priority | File                                             | Changes Needed                                                          |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| 15       | `src/lib/components/trip/DestinationList.svelte` | `export let` → `$props()`, dispatch → callback                          |
| 16       | `src/lib/components/trip/TripDebug.svelte`       | Check for legacy patterns                                               |
| 17       | `src/lib/components/trip/TripForm.svelte`        | `on:*` → native, dispatch → callback (partial runes - needs completion) |

### Phase 5: HughesNet Components

_Specialized integration components._

| Priority | File                                                   | Changes Needed                                                  |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 21       | `src/lib/components/hughesnet/OrderList.svelte`        | `export let` → `$props()`                                       |
| 22       | `src/lib/components/hughesnet/ConfigForm.svelte`       | `export let` → `$props()`                                       |
| 23       | `src/lib/components/hughesnet/ConnectionStatus.svelte` | `export let` → `$props()`, dispatch → callback, `on:*` → native |
| 24       | `src/lib/components/hughesnet/DebugConsole.svelte`     | `export let` → `$props()`, `on:*` → native                      |
| 25       | `src/lib/components/hughesnet/ArchivedRestore.svelte`  | dispatch → callback, `on:*` → native                            |

### Phase 6: Dashboard Setting Components

_Nested components in settings pages._

| Priority | File                                                              | Changes Needed                                                            |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 26       | `src/routes/dashboard/settings/SettingsLayout.svelte`             | `export let` → `$props()`                                                 |
| 27       | `src/routes/dashboard/settings/components/ProfileCard.svelte`     | `export let` → `$props()`, dispatch → callback, `on:*` → native           |
| 28       | `src/routes/dashboard/settings/components/SecurityCard.svelte`    | dispatch → callback, `on:*` → native                                      |
| 29       | `src/routes/dashboard/settings/components/DataCard.svelte`        | dispatch → callback, `on:*` → native                                      |
| 30       | `src/routes/dashboard/settings/components/MaintenanceCard.svelte` | `$:` → `$derived`, dispatch → callback, `on:*` → native                   |
| 31       | `src/routes/dashboard/settings/components/ExportModal.svelte`     | `export let` → `$props()`, `$:` → `$derived/$effect`, dispatch → callback |

### Phase 7: Dashboard Trip Components

_Trip-specific UI components._

| Priority | File                                                         | Changes Needed                                                                     |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 32       | `src/routes/dashboard/trips/components/TripStats.svelte`     | `export let` → `$props()`                                                          |
| 33       | `src/routes/dashboard/trips/components/TripFilters.svelte`   | `export let` → `$props()`                                                          |
| 34       | `src/routes/dashboard/trips/components/ActionBar.svelte`     | `export let` → `$props()`, dispatch → callback                                     |
| 35       | `src/routes/dashboard/trips/components/TripCard.svelte`      | `export let` → `$props()`, `$:` → `$derived`, dispatch → callback, `on:*` → native |
| 36       | `src/routes/dashboard/trips/components/SettingsModal.svelte` | `export let` → `$props()`, `$:` → `$derived`, dispatch → callback                  |
| 37       | `src/routes/dashboard/trips/components/UpgradeModal.svelte`  | `export let` → `$props()`, `on:*` → native                                         |

### Phase 8: Dashboard Mileage Components

_Mileage tracking components._

| Priority | File                                                           | Changes Needed                                                                     |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 38       | `src/routes/dashboard/mileage/components/SettingsModal.svelte` | `export let` → `$props()`, `$:` → `$derived`, dispatch → callback, `on:*` → native |

### Phase 9: Simple Route Pages (No Forms)

_Static or simple informational pages._

| Priority | File                              | Changes Needed                                       |
| -------- | --------------------------------- | ---------------------------------------------------- |
| 39       | `src/routes/+error.svelte`        | `$:` → `$derived` (partial runes - needs completion) |
| 40       | `src/routes/privacy/+page.svelte` | Check for legacy patterns                            |
| 41       | `src/routes/terms/+page.svelte`   | Check for legacy patterns                            |
| 42       | `src/routes/support/+page.svelte` | Check for legacy patterns                            |
| 43       | `src/routes/docs/+page.svelte`    | `on:*` → native                                      |
| 44       | `src/routes/contact/+page.svelte` | `export let` → `$props()`, `on:*` → native           |

### Phase 10: Auth Pages

_Login, registration, password reset pages._

| Priority | File                                          | Changes Needed                             |
| -------- | --------------------------------------------- | ------------------------------------------ |
| 45       | `src/routes/forgot-password/+page.svelte`     | `on:*` → native                            |
| 46       | `src/routes/reset-password/+page.svelte`      | `$:` → `$derived/$effect`, `on:*` → native |
| 47       | `src/routes/api/forgot-password/+page.svelte` | `on:*` → native                            |
| 48       | `src/routes/api/reset-password/+page.svelte`  | `$:` → `$derived/$effect`, `on:*` → native |
| 49       | `src/routes/login/+page.svelte`               | `$:` → `$derived/$effect`, `on:*` → native |
| 50       | `src/routes/debug/passkey-demo/+page.svelte`  | `on:*` → native                            |

### Phase 11: Dashboard CRUD Pages

_Pages with forms and data operations._

| Priority | File                                          | Changes Needed                             |
| -------- | --------------------------------------------- | ------------------------------------------ |
| 51       | `src/routes/dashboard/data/+page.svelte`      | `on:*` → native                            |
| 52       | `src/routes/dashboard/import/+page.svelte`    | `on:*` → native                            |
| 53       | `src/routes/dashboard/export/+page.svelte`    | `$:` → `$derived/$effect`, `on:*` → native |
| 54       | `src/routes/dashboard/trash/+page.svelte`     | `on:*` → native                            |
| 55       | `src/routes/dashboard/profile/+page.svelte`   | Check for legacy patterns                  |
| 56       | `src/routes/dashboard/maps/+page.svelte`      | Check for legacy patterns                  |
| 57       | `src/routes/dashboard/tracks/+page.svelte`    | Check for legacy patterns                  |
| 58       | `src/routes/dashboard/hughesnet/+page.svelte` | `$:` → `$derived/$effect`, `on:*` → native |

### Phase 12: Dashboard Entity Pages (Expenses)

_Expense management pages._

| Priority | File                                                   | Changes Needed                                                        |
| -------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| 59       | `src/routes/dashboard/expenses/new/+page.svelte`       | `$:` → `$derived/$effect`, `on:*` → native                            |
| 60       | `src/routes/dashboard/expenses/edit/[id]/+page.svelte` | `$:` → `$derived/$effect`, `on:*` → native                            |
| 61       | `src/routes/dashboard/expenses/+page.svelte`           | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |

### Phase 13: Dashboard Entity Pages (Mileage)

_Mileage tracking pages._

| Priority | File                                                  | Changes Needed                                                        |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 62       | `src/routes/dashboard/mileage/new/+page.svelte`       | `$:` → `$derived/$effect`, `on:*` → native                            |
| 63       | `src/routes/dashboard/mileage/edit/[id]/+page.svelte` | `$:` → `$derived/$effect`, `on:*` → native                            |
| 64       | `src/routes/dashboard/mileage/+page.svelte`           | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |

### Phase 14: Dashboard Entity Pages (Trips)

_Trip management pages - most complex._

| Priority | File                                                | Changes Needed                                                        |
| -------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| 65       | `src/routes/dashboard/trips/new/+page.svelte`       | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |
| 66       | `src/routes/dashboard/trips/edit/[id]/+page.svelte` | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |
| 67       | `src/routes/dashboard/trips/+page.svelte`           | `$:` → `$derived/$effect`, `on:*` → native                            |

### Phase 15: Dashboard Settings Page

_Settings with multiple sub-components._

| Priority | File                                         | Changes Needed                                                        |
| -------- | -------------------------------------------- | --------------------------------------------------------------------- |
| 68       | `src/routes/dashboard/settings/+page.svelte` | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |

### Phase 16: Layout Files

_Root layouts - migrate last to avoid breaking changes._

| Priority | File                                  | Changes Needed                                                        |
| -------- | ------------------------------------- | --------------------------------------------------------------------- |
| 69       | `src/routes/dashboard/+page.svelte`   | `$:` → `$derived/$effect`, `on:*` → native                            |
| 70       | `src/routes/dashboard/+layout.svelte` | `export let` → `$props()`, `$:` → `$derived/$effect`, `on:*` → native |
| 71       | `src/routes/+page.svelte`             | `on:*` → native                                                       |
| 72       | `src/routes/+layout.svelte`           | dispatch → callback (partial runes - needs completion)                |

---

## Store Migration (Optional but Recommended)

The stores in `src/lib/stores/` use Svelte 4's `writable`/`readable`/`derived` pattern. These still work in Svelte 5, but can be migrated to use runes for consistency.

### Stores to Consider Migrating

| File                             | Current Pattern       | Notes                    |
| -------------------------------- | --------------------- | ------------------------ |
| `src/lib/stores/auth.ts`         | writable + derived    | Large, consider last     |
| `src/lib/stores/trips.ts`        | writable              | Contains IndexedDB logic |
| `src/lib/stores/expenses.ts`     | writable              | CRUD store               |
| `src/lib/stores/mileage.ts`      | writable              | CRUD store               |
| `src/lib/stores/trash.ts`        | writable              | Simple store             |
| `src/lib/stores/toast.ts`        | writable              | Simple store             |
| `src/lib/stores/sync.ts`         | writable              | Sync state               |
| `src/lib/stores/userSettings.ts` | writable              | Settings store           |
| `src/lib/stores/currentUser.ts`  | writable + derived    | User state               |
| `src/lib/stores/user.svelte.ts`  | Already uses runes ✅ | Reference example        |

---

## Files Already Fully Migrated (No Changes Needed)

These files are already using Svelte 5 runes completely:

1. `src/lib/components/ErrorBoundary.svelte` ✅
2. `src/lib/components/layout/Header.svelte` ✅
3. `src/lib/components/layout/Footer.svelte` ✅
4. `src/lib/components/trip/TripSummary.svelte` ✅
5. `src/lib/components/ui/Modal.svelte` ✅

## Files Partially Migrated (Need Completion)

These files have started using runes but still contain legacy patterns:

1. `src/lib/components/trip/TripForm.svelte` - has runes but still uses `on:*` and dispatch
2. `src/routes/+layout.svelte` - has runes but still uses dispatch
3. `src/routes/+error.svelte` - has runes but still uses `$:` statements

---

## Migration Checklist Per File

When migrating each file, verify:

- [ ] All `export let` converted to `$props()`
- [ ] All `$:` reactive statements converted to `$derived()` or `$effect()`
- [ ] All `on:event` handlers converted to `onevent` attributes
- [ ] All `createEventDispatcher` patterns converted to callback props
- [ ] All `<slot />` converted to `{@render children?.()}`
- [ ] All named slots converted to snippet props
- [ ] Component still renders correctly
- [ ] All interactions work as expected
- [ ] No TypeScript errors
- [ ] Lint passes

---

## Testing Strategy

After migrating each phase:

1. Run `npm run check` to verify TypeScript
2. Run `npm run lint` to check formatting
3. Run `npm run build` to verify build
4. Run `npx vitest run` to run unit tests
5. Manually test affected pages in browser

---

## Agent Instructions for Automated Migration

When using an AI agent to perform migrations, provide these instructions:

```
MIGRATION TASK: Migrate [filename] from Svelte 4 to Svelte 5 runes syntax.

REQUIREMENTS:
1. Convert all `export let propName` to destructured `$props()`
2. Convert all `$: variable = expression` to `const variable = $derived(expression)`
3. Convert all `$: { sideEffect }` to `$effect(() => { sideEffect })`
4. Convert all `on:eventname={handler}` to `oneventname={handler}`
5. Convert all `on:eventname` (forwarding) to callback props
6. Convert `createEventDispatcher` to callback props
7. Convert `<slot />` to `{@render children?.()}`
8. Convert named slots to snippet props
9. Preserve all existing functionality
10. Maintain TypeScript types
11. Do NOT change business logic
12. Do NOT add new features
13. Do NOT remove any functionality

VALIDATION:
- File must have no `export let` statements
- File must have no `$:` statements
- File must have no `on:` event directives (use onclick, onchange, etc.)
- File must have no `createEventDispatcher` usage
- File must have no `<slot` tags (unless explicitly using Svelte 4 compatibility)
```

---

## Notes

- Svelte 5 is backward compatible with most Svelte 4 patterns, so migration can be gradual
- Focus on one phase at a time to minimize risk
- The Modal component is a good reference for proper Svelte 5 patterns
- Store migration is optional but improves consistency
