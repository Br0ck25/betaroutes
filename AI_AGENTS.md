# AI Agent Instructions

**CRITICAL:** You are working on a governed codebase with strict, non-negotiable rules.

---

## ⚠️ READ THESE FIRST (MANDATORY)

Before making ANY changes, read these documents in order:

1. **`GOVERNANCE.md`** — Rule hierarchy and conflict resolution
2. **`svelte-mixed-migration-agent.md`** — Complete migration strategy
3. **`PWA.md`** — PWA requirements (HIGHER precedence than migration)
4. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules (HIGHER precedence than migration)
5. **`DESIGN_SYSTEM.md`** — Color palette (HIGHER precedence than migration)

---

## Rule Precedence (Most Important)

When rules conflict, this is the hierarchy (highest to lowest):

1. Safety & Security
2. **PWA Compliance** ← Can block migration
3. **HTML Living Standard** ← Can block migration
4. **Design System** ← Can block migration
5. Migration Agent Rules
6. Code Style

**If migration conflicts with rules 2-4, DO NOT MIGRATE.**

---

## Core Principles

### Editing ≠ Migrating

**CRITICAL RULE:** Just because you're editing a file does NOT mean you should migrate it.

**Edit in Svelte 4 if:**

- Fixing a bug
- Updating text/labels
- Adding/removing props
- Changing styles
- Updating imports
- Adding event handlers

**Only migrate if:**

- User explicitly requests migration, OR
- Task requires Svelte 5 features (cannot be done in Svelte 4)

### New Code = Svelte 5

ALL new files and features MUST use Svelte 5 syntax:

- ✅ Use `$state`, `$derived`, `$effect`, `$props`
- ❌ No new Svelte 4 syntax
- ❌ No legacy stores unless interacting with existing ones

---

## Prohibited Behaviors

You MUST NEVER:

❌ Migrate a file just because you're editing it  
❌ Introduce colors outside the approved palette  
❌ Break PWA offline functionality  
❌ Generate invalid HTML (no `<div />` self-closing)  
❌ Use boolean attributes incorrectly (`disabled="true"` is wrong)  
❌ Modify `manifest.json` without explicit approval  
❌ Change service worker without explicit approval  
❌ Migrate adjacent or related files opportunistically  
❌ "Finish" partially migrated areas  
❌ Bypass governance rules "to be helpful"  
❌ Assume user intent overrides governance  
❌ Justify changes with "best practices" or "modern patterns"

---

## Required Behaviors

You MUST ALWAYS:

✅ Stop and ask when rules conflict  
✅ Preserve PWA installability and offline behavior  
✅ Generate valid HTML Living Standard markup  
✅ Use only approved colors from `DESIGN_SYSTEM.md`  
✅ Keep component APIs backward-compatible during migration  
✅ Preserve existing behavior exactly  
✅ Make minimal, localized changes  
✅ Cite specific governance documents when declining requests  
✅ Suggest governance-compliant alternatives  
✅ Read migration annotations (`// MIGRATED_TO_SVELTE_5 - DATE`)

---

## Common Scenarios

### Scenario 1: User asks to fix a typo in a Svelte 4 component

**CORRECT:**

```svelte
<!-- Fix the typo in Svelte 4 syntax -->
<script>
	export let title = ''; // was 'titel'
</script>
```

**WRONG:**

```svelte
<!-- Don't migrate to Svelte 5 just because you're here -->
<script>
	let { title = '' } = $props();
</script>
```

---

### Scenario 2: User asks to add a new feature

**CORRECT:**

- Create a NEW Svelte 5 component
- Use `$state`, `$derived`, `$effect` as needed
- Ensure it can be consumed by existing Svelte 4 code if necessary

**WRONG:**

- Creating new Svelte 4 components
- Migrating existing components to "match" the new one

---

### Scenario 3: User asks to change a button color

**Check `DESIGN_SYSTEM.md` first:**

**CORRECT:**

```svelte
<button style="background-color: #F68A2E;">Click</button>
<!-- #F68A2E is approved -->
```

**WRONG:**

```svelte
<button style="background-color: #FF5722;">Click</button>
<!-- #FF5722 is NOT in the approved palette -->
```

**If asked to use non-approved color:**
I cannot use #FF5722 as it's not in the approved color palette
(see DESIGN_SYSTEM.md). The closest approved color is #F68A2E
(primary orange). Would you like me to use that instead?

---

### Scenario 4: User asks to add offline functionality

**Before making changes:**

1. Check if this affects service worker
2. Check if this affects caching strategy
3. Review `PWA.md` requirements

**If uncertain:**
This change affects PWA offline behavior. Before proceeding, I need
to verify it won't break existing offline functionality. Can you
confirm this is intended to modify the service worker?

---

### Scenario 5: User asks to "clean up" or "modernize" old code

**CORRECT:**
I can see opportunities to modernize this code, but per the
governance rules, I should only make changes that are explicitly
requested. Would you like me to:

Migrate this specific file to Svelte 5, OR
Leave it in Svelte 4 and address only the specific issue?

**WRONG:**

- Migrating files without permission
- Refactoring unrelated code
- "Improving" code that works

---

## Stop Conditions (MANDATORY)

**STOP immediately and ask if:**

- A change would alter runtime behavior
- A public API would change
- More than one architectural option exists
- Migration would break PWA offline functionality
- A color outside the approved palette would be used
- Invalid HTML would be generated
- Service worker or manifest.json would be modified
- Breaking changes are required
- You're unsure if a governance rule applies

**Better to ask than to violate governance.**

---

## Quick Reference Card

| Situation                     | Action                                         |
| ----------------------------- | ---------------------------------------------- |
| Fixing bug in Svelte 4 file   | ✅ Fix in Svelte 4, don't migrate              |
| Creating new component        | ✅ Use Svelte 5                                |
| Need a new color              | ❌ STOP - check DESIGN_SYSTEM.md first         |
| Touching service worker       | ❌ STOP - ask before proceeding                |
| User says "modernize this"    | ❌ STOP - ask what specifically to change      |
| Invalid HTML in existing file | ✅ Fix to be valid HTML                        |
| Component needs new prop      | ✅ Add prop in current version (don't migrate) |
| Routing change                | ⚠️ Verify PWA offline still works              |

---

## Migration Progress Tracking

When you migrate a file, add this comment at the top:

```javascript
// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD
```

Or if partially migrated:

```javascript
// PARTIALLY_MIGRATED_TO_SVELTE_5 - YYYY-MM-DD
```

**Never remove these annotations.**

---

## Conflict Resolution

**If governance rules seem to conflict:**

1. Check `GOVERNANCE.md` for precedence order
2. Higher-numbered rules yield to lower-numbered rules
3. If still unclear: **STOP and ask**

**Example:**

- Migration suggests using Svelte 5 syntax
- But it would generate `<div />` (invalid HTML)
- **HTML rules (precedence 3) beat migration (precedence 5)**
- **Solution:** Use valid HTML even if less "modern"

---

## Testing Your Changes

After making changes:

```bash
npm run check  # Type checking
npm run lint   # Linting
```

If you modified:

- **Routes/navigation** → Verify offline mode still works
- **HTML markup** → Verify it's valid (no self-closing non-void elements)
- **Styles** → Verify colors are from approved palette
- **Service worker** → Don't do this without explicit approval

---

## When in Doubt

**Default behaviors when uncertain:**

1. **Preserve existing behavior** over making changes
2. **Do less** over doing more
3. **Ask** over guessing
4. **Keep Svelte 4** over migrating unnecessarily
5. **Use approved colors** over introducing new ones
6. **Maintain PWA functionality** over new features

---

## Remember

- This is a **governance-first, migration-second** project
- Editing ≠ Migrating
- PWA, HTML, and Design System rules trump migration preferences
- When rules conflict, check `GOVERNANCE.md` for precedence
- When uncertain, STOP and ask
- Better to be cautious than to violate governance

**Your goal:** Make Svelte 5 inevitable while respecting all constraints.
