# Key Updates Needed for SVELTE5_MIGRATION.md

## 1. Add Error Prevention Section (at the top, after "Current State Summary")

---

## ⚠️ CRITICAL: Migration Error Prevention

**Before migrating ANY file, read these error prevention rules:**

### Common Migration Errors to Avoid

1. **Forgetting `lang="ts"` when adding TypeScript**
   - ❌ Adding `$state<Type[]>()` without `lang="ts"` → 50+ parse errors
   - ✅ ALWAYS add `<script lang="ts">` when using type parameters

2. **Partial Migration (Mixing Svelte 4/5)**
   - ❌ Keeping `export let` while adding `$state()` → File broken
   - ✅ Migrate the ENTIRE file at once, not piece by piece

3. **Missing Returns in Event Handlers**
   - ❌ Converting `on:click` to `onclick` but forgetting return values
   - ✅ Ensure all event handlers work correctly after migration

4. **Breaking Component APIs**
   - ❌ Changing prop names during migration → Breaks parent components
   - ✅ Keep prop names identical, only change internal syntax

### Migration Safety Checklist

Before starting migration:

- [ ] Read `SVELTE5_STANDARDS.md` for correct patterns
- [ ] Identify all props, events, and slots in the file
- [ ] Plan the full migration (don't do it incrementally)
- [ ] Ensure you have `lang="ts"` if using TypeScript

During migration:

- [ ] Convert ALL `export let` at once
- [ ] Convert ALL `$:` statements at once
- [ ] Convert ALL `on:*` handlers at once
- [ ] Convert ALL slots/dispatchers at once
- [ ] Keep prop/event names identical

After migration:

- [ ] Run `npm run check` - MUST pass with 0 errors
- [ ] Run `npm run lint` - MUST pass
- [ ] Test the component manually
- [ ] Add `// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD` at top

### If You See Errors After Migration

**STOP immediately if `npm run check` shows errors.**

DO NOT:

- ❌ Try to "fix" errors with more changes
- ❌ Continue with other files
- ❌ Commit broken code

DO:

- ✅ Review what you changed
- ✅ Check if you forgot `lang="ts"`
- ✅ Check if you mixed Svelte 4/5 syntax
- ✅ Consider reverting and re-planning
- ✅ Ask for help

---

## 2. Update "Migration Checklist Per File" Section

Replace the existing checklist with:

---

## Migration Checklist Per File

When migrating each file, verify:

**TypeScript Setup:**

- [ ] Add `lang="ts"` to `<script>` tag if using TypeScript syntax
- [ ] All type parameters are correctly specified

**Svelte 5 Conversion:**

- [ ] All `export let` converted to `$props()`
- [ ] All `$:` reactive statements converted to `$derived()` or `$effect()`
- [ ] All `on:event` handlers converted to `onevent` attributes
- [ ] All `createEventDispatcher` patterns converted to callback props
- [ ] All `<slot />` converted to `{@render children?.()}`
- [ ] All named slots converted to snippet props

**Validation:**

- [ ] Component still renders correctly
- [ ] All interactions work as expected
- [ ] Props/events have same names as before (API compatibility)
- [ ] No TypeScript errors (`npm run check` passes)
- [ ] Lint passes (`npm run lint`)
- [ ] Add migration annotation: `// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD`

**Critical Checks:**

- [ ] NO `export let` statements remain
- [ ] NO `$:` statements remain
- [ ] NO `on:` event directives remain (use onclick, onchange, etc.)
- [ ] NO `createEventDispatcher` usage remains
- [ ] NO `<slot>` tags remain
- [ ] NO mix of Svelte 4/5 syntax

---

## 3. Update "Agent Instructions for Automated Migration"

Replace the existing agent instructions with:

---

## Agent Instructions for Automated Migration

When using an AI agent to perform migrations, provide these instructions:

```
MIGRATION TASK: Migrate [filename] from Svelte 4 to Svelte 5 runes syntax.

CRITICAL RULES:
1. If using TypeScript syntax, MUST add lang="ts" to <script> tag
2. Migrate the ENTIRE file at once (no partial migrations)
3. Run `npm run check` after migration - MUST pass with 0 errors
4. If errors appear, STOP and review (don't try to "fix" with more changes)

REQUIREMENTS:
1. Add `lang="ts"` if using ANY TypeScript syntax (<Type>, : Type, interface, type)
2. Convert all `export let propName` to destructured `$props()`
3. Convert all `$: variable = expression` to `const variable = $derived(expression)`
4. Convert all `$: { sideEffect }` to `$effect(() => { sideEffect })`
5. Convert all `on:eventname={handler}` to `oneventname={handler}`
6. Convert all `on:eventname` (forwarding) to callback props
7. Convert `createEventDispatcher` to callback props
8. Convert `<slot />` to `{@render children?.()}`
9. Convert named slots to snippet props
10. Keep prop/event names IDENTICAL (maintain API compatibility)
11. Preserve all existing functionality
12. Maintain TypeScript types
13. Do NOT change business logic
14. Do NOT add new features
15. Do NOT remove any functionality

VALIDATION (MANDATORY):
- File must have `lang="ts"` if using TypeScript syntax
- File must have no `export let` statements
- File must have no `$:` statements
- File must have no `on:` event directives (use onclick, onchange, etc.)
- File must have no `createEventDispatcher` usage
- File must have no `<slot>` tags
- `npm run check` must pass with 0 errors
- `npm run lint` must pass
- Add comment at top: `// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD`

STOP CONDITIONS:
- If you create 5+ TypeScript errors → STOP, don't continue
- If you're unsure about a pattern → STOP and ask
- If component has complex logic you don't understand → STOP and ask
```

---

## 4. Add New Section Before "Notes"

---

## Common Migration Pitfalls

### Pitfall #1: Forgetting `lang="ts"`

**Symptom:** 50+ errors like `'<' cannot be applied to types`, `'string' only refers to a type`

**Cause:**

```svelte
<script>
	// Missing lang="ts"
	let items = $state<Item[]>([]); // TypeScript syntax without lang="ts"
</script>
```

**Fix:**

```svelte
<script lang="ts">
	// Added lang="ts"
	let items = $state<Item[]>([]);
</script>
```

### Pitfall #2: Partial Migration

**Symptom:** Mix of Svelte 4 and 5 syntax, component broken

**Cause:**

```svelte
<script>
	export let title; // Svelte 4
	let count = $state(0); // Svelte 5 - CONFLICT!
</script>
```

**Fix:** Migrate the entire file at once:

```svelte
<script lang="ts">
	let { title } = $props<{ title: string }>();
	let count = $state(0);
</script>
```

### Pitfall #3: Changing Prop Names

**Symptom:** Parent components break after migration

**Cause:**

```svelte
<!-- Before -->
export let tripData;

<!-- After - WRONG -->
let {data} = $props(); // Changed name from tripData to data!
```

**Fix:** Keep the same prop name:

```svelte
<!-- After - CORRECT -->
let { tripData } = $props<{ tripData: Trip }>();
```

### Pitfall #4: Incorrect Event Handler Conversion

**Symptom:** Events don't fire after migration

**Cause:**

```svelte
<!-- Before -->
<button on:click={handleClick}>Click</button>

<!-- After - WRONG -->
<button click={handleClick}>Click</button>
<!-- Missing 'on' prefix -->
```

**Fix:**

```svelte
<!-- After - CORRECT -->
<button onclick={handleClick}>Click</button>
<!-- 'onclick' not 'click' -->
```

---

## 5. Update the Note at the End

Replace the last paragraph with:

---

## Notes

- Svelte 5 is backward compatible with most Svelte 4 patterns, so migration can be gradual
- However, DO NOT partially migrate files - migrate each file completely
- Focus on one phase at a time to minimize risk
- The Modal component is a good reference for proper Svelte 5 patterns
- **ALWAYS add `lang="ts"` when using TypeScript syntax**
- **ALWAYS run `npm run check` after migration - it must pass**
- Store migration is optional but improves consistency
- See `SVELTE5_STANDARDS.md` for the permanent reference on Svelte 5 patterns

---
