# AI Agent Instructions

**CRITICAL:** You are working on a governed codebase with strict, non-negotiable rules.

**⚠️ This application handles sensitive data: passwords, financial information, trip addresses, and personal data.**

---

## ⚠️ READ THESE FIRST (MANDATORY)

Before making ANY changes, read these documents in order:

1. **`SECURITY.md`** — **READ FIRST** - Security has absolute highest priority
2. **`GOVERNANCE.md`** — Rule hierarchy and conflict resolution
3. **`AI_AGENTS.md`** — This file (quick reference and error prevention)
4. **`SVELTE5_STANDARDS.md`** — Standards for **new** Svelte 5 files only
5. **`SVELTE5_MIGRATION.md`** — Migration rules (only when migrating)
6. **`PWA.md`** — PWA requirements (HIGHER precedence than migration)
7. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules (HIGHER precedence than migration)
8. **`DESIGN_SYSTEM.md`** — Color palette (HIGHER precedence than migration)

---

## 🛑 STOP CONDITIONS (Mandatory)

**STOP and ask the user before proceeding if:**

1. **Migration Decision Required:**
   - You're about to change a Svelte 4 file that uses `export let`, `$:`, or `<slot>`
   - The user did NOT explicitly request migration to Svelte 5
   - The task CAN be completed in Svelte 4 syntax

2. **TypeScript Errors After Your Changes:**
   - You made changes and `npm run check` would show NEW errors
   - **DO NOT try to "fix" these errors by making more changes**
   - **STOP, review what you changed, consider reverting**
   - **Ask the user if the approach is correct**

3. **Security Impact:**
   - Any change that touches authentication, passwords, or user data access
   - Any change to API endpoints that return user data
   - Any change to KV key patterns or data access logic

4. **Architectural Changes:**
   - Multiple ways to solve a problem exist
   - Breaking changes to public APIs
   - Service worker or PWA manifest modifications
   - Routing changes that might affect offline behavior

5. **Governance Conflicts:**
   - Non-approved colors would be introduced
   - Invalid HTML would be generated
   - More than one architectural option exists
   - You're unsure about any governance rule

---

## ⚠️ CRITICAL ERRORS TO AVOID

### Error Pattern #1: Forgetting `lang="ts"`

**Symptom:** 50+ parse errors like `'<' cannot be applied to types`, `'string' only refers to a type`

**Cause:** Added TypeScript syntax without `lang="ts"`

❌ **WRONG:**

```svelte
<script>
	let items = $state<Item[]>([]); // Parse error!
</script>
```

✅ **CORRECT:**

```svelte
<script lang="ts">
	let items = $state<Item[]>([]);
</script>
```

**Prevention:** If you add ANY TypeScript syntax (`: Type`, `<Type>`, `interface`, `type`), you MUST add `lang="ts"` to the `<script>` tag.

---

### Error Pattern #2: Partial Migration (Svelte 4 + 5 Mix)

**Symptom:** File uses both `export let` AND `$state()`, errors everywhere

**Cause:** Attempted to add Svelte 5 features to a Svelte 4 file

❌ **WRONG:**

```svelte
<script>
	export let title; // Svelte 4
	let count = $state(0); // Svelte 5 - CONFLICT!
</script>
```

**Prevention:** Before touching a .svelte file, ask:

1. Is this file already Svelte 5? (uses `$props()`, `$state()`, `$derived()`)
2. Did the user request migration?
3. Can I complete this task in the current version?

If NO to questions 2-3, **STAY IN THE CURRENT VERSION.**

---

### Error Pattern #3: Server Routes Missing Returns

**Symptom:** `Not all code paths return a value`, `Type 'undefined' is not assignable to type 'Response'`

**Cause:** RequestHandler function doesn't return Response on all code paths

❌ **WRONG:**

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
		// FORGOT RETURN!
	}

	// Do something...
	// FORGOT FINAL RETURN!
};
```

✅ **CORRECT:**

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const result = await doSomething();
	return new Response(JSON.stringify({ success: true, data: result }));
};
```

**Prevention:** Every `RequestHandler` MUST have a `return` statement on EVERY code path.

---

### Error Pattern #4: Passing Possibly Undefined Values

**Symptom:** `Object is possibly 'undefined'`, `Argument of type 'T | undefined' is not assignable`

**Cause:** Passing array elements or optional values without checking

❌ **WRONG:**

```typescript
const items = [a, b, c];
const index = items.indexOf(target);
const item = items[index]; // Could be undefined if indexOf returns -1
doSomething(item); // Error!
```

✅ **CORRECT:**

```typescript
const items = [a, b, c];
const index = items.indexOf(target);

if (index === -1) {
	return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

const item = items[index]!; // Safe after guard
doSomething(item);
```

**Prevention:** Always guard array indexing and optional values before passing to functions.

---

### Error Pattern #5: Unreachable Code

**Symptom:** `Unreachable code detected`

**Cause:** Code placed after a `return` statement

❌ **WRONG:**

```typescript
if (error) {
	return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
	assignments[idx].stops.push(stop); // UNREACHABLE!
}
```

✅ **CORRECT:**

```typescript
if (error) {
	console.error('Failed:', error);
	return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
}

assignments[idx].stops.push(stop); // Reachable
```

**Prevention:** Never place code after a `return` statement.

## Error Handling in Server Code (Mandatory)

### Rule: Always Use Error Variables in Server Routes

**In server-side code (`+server.ts`, API routes, server utilities):**

❌ **NEVER ignore error variables without logging:**

```typescript
try {
	const result = await riskyOperation();
} catch (e) {
	// ← ESLint error: unused variable
	return fallbackValue;
}
```

✅ **ALWAYS log errors in server code:**

```typescript
try {
	const result = await riskyOperation();
} catch (e) {
	log.warn('[CONTEXT] Operation failed', { err: (e as Error).message });
	return fallbackValue;
}
```

✅ **Only use underscore prefix for truly intentional silence (rare):**

```typescript
try {
	const optional = JSON.parse(maybeJson);
} catch (_e) {
	// Intentionally ignoring - optional JSON, expected to fail sometimes
	return null;
}
```

---

### Server-Side Logging Patterns

**Pattern 1: Cache Read Failure (Warning)**

```typescript
try {
	if (kv) {
		const raw = await kv.get(key); // ← Keep the actual operation!
		if (raw) {
			const data = JSON.parse(String(raw));
			return data;
		}
	}
} catch (e) {
	log.warn('[CACHE] Read failed', { key, err: (e as Error).message });
}
```

**Pattern 2: External API Failure (Warning)**

```typescript
try {
	const response = await fetch(externalApi);
	const data = await response.json();
	return data;
} catch (e) {
	log.warn('[EXTERNAL API] Request failed', { url: externalApi, err: (e as Error).message });
	return fallbackData;
}
```

**Pattern 3: User Input Validation (No log needed)**

```typescript
try {
	const parsed = JSON.parse(userInput);
	return parsed;
} catch (_e) {
	// User input validation - expected to fail on bad input
	return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
}
```

**Pattern 4: Critical Operation (Error)**

```typescript
try {
	await criticalDatabaseWrite(data);
} catch (e) {
	log.error('[DATABASE] Write failed - data loss possible', { err: (e as Error).message });
	return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
}
```

---

### When to Log vs. When to Ignore

**ALWAYS log (warning or error):**

- ✅ Cache read/write failures
- ✅ External API failures
- ✅ Database operation failures
- ✅ File system operations
- ✅ Unexpected JSON parse errors (corrupted cache data)
- ✅ KV namespace operations

**May use `_e` to ignore (rare):**

- ✅ Expected user input validation failures (then return error response)
- ✅ Optional parsing that's expected to fail sometimes
- ✅ Probe operations checking if something exists

**NEVER ignore:**

- ❌ Operations that affect data integrity
- ❌ Operations that could indicate infrastructure problems
- ❌ Operations where you'd want to debug production issues later

---

### Critical: Don't Delete Actual Operations

When adding error logging, **do not accidentally delete the operation itself:**

❌ **WRONG - Deleted the KV read:**

```typescript
try {
	if (kv) {
		// const raw = await kv.get(key);  ← DELETED!
		if (raw) {
			// ← 'raw' is undefined!
			// ...
		}
	}
} catch (e) {
	log.warn('[CACHE] Failed', { err: (e as Error).message });
}
```

✅ **CORRECT - Keep the operation, add logging:**

```typescript
try {
	if (kv) {
		const raw = await kv.get(key); // ← Keep this!
		if (raw) {
			// ...
		}
	}
} catch (e) {
	log.warn('[CACHE] Failed', { err: (e as Error).message });
}
```

---

### ESLint Rule Handling

If you see `@typescript-eslint/no-unused-vars` for error variables:

1. **First, ask:** Should this error be logged?
2. **In server code:** 90% of the time, YES - add logging
3. **Only use `_e`:** If truly intentional and well-documented

**Do NOT:**

- ❌ Delete the try-catch
- ❌ Delete error handling logic
- ❌ Ignore the lint error without addressing it
- ❌ Remove the operation that's being caught

---

### Quick Decision Tree

```
Is this server-side code (+server.ts, API route)?
├─ YES
│  └─ Does the catch block handle an operation that could fail?
│     ├─ Cache/KV operation → LOG with log.warn()
│     ├─ External API → LOG with log.warn()
│     ├─ Database operation → LOG with log.error()
│     ├─ File operation → LOG with log.warn()
│     ├─ User input validation → Use _e, return error response
│     └─ Optional parsing → Use _e with comment
│
└─ NO (client-side)
   └─ Use _e if truly intentional
```

---

### Server Logging Best Practices

**Include context in logs:**

```typescript
// ❌ Not helpful
log.warn('Failed');

// ✅ Helpful
log.warn('[ROUTE CACHE] Read failed', {
	key: cacheKey,
	err: (e as Error).message
});
```

**Use appropriate log levels:**

- `log.info()` - Normal operations, milestones
- `log.warn()` - Recoverable failures, fallback used
- `log.error()` - Serious failures, data integrity issues

**Never log sensitive data:**

- ❌ Full addresses
- ❌ Dollar amounts
- ❌ User IDs (use generic identifiers)
- ❌ Authentication tokens
- ✅ Error messages (sanitized)
- ✅ Operation types
- ✅ Generic identifiers

---

### Summary for AI Agents

**When you see unused error variable in server code:**

1. ✅ **Add logging** - Default action for server code
2. ✅ **Keep the operation** - Don't delete the actual async call
3. ✅ **Use appropriate log level** - warn for recoverable, error for serious
4. ✅ **Include context** - What failed, what key, what operation
5. ❌ **Don't use `_e`** - Unless truly intentional and documented

**This prevents:**

- Production debugging nightmares
- Silent cache failures
- Invisible infrastructure issues
- Accidentally deleting critical operations

---

## 📋 Pre-Flight Checklist (Before Making ANY Change)

**For .svelte files:**

- [ ] Is this file Svelte 4 or Svelte 5?
  - Check for `$props()`, `$state()`, `$derived()` = Svelte 5
  - Check for `export let`, `$:`, `<slot>` = Svelte 4
- [ ] Did user explicitly request migration?
  - NO → Stay in current version
- [ ] Am I adding TypeScript syntax?
  - YES → Must add `lang="ts"` to `<script>` tag
- [ ] Am I changing event handlers?
  - Svelte 5 → Use `onclick`, `oninput`, etc.
  - Svelte 4 → Use `on:click`, `on:input`, etc.

**For +server.ts files:**

- [ ] Does every code path return a `Response`?
- [ ] Are all early returns for errors using `return new Response(...)`?
- [ ] Am I guarding optional/undefined values before passing to functions?
- [ ] Is there code after any `return` statement? (Remove it)
- [ ] Am I verifying user ownership before returning data?

**For security-sensitive code:**

- [ ] Did I read `SECURITY.md`?
- [ ] Am I authenticating using `locals.user` (NOT client-provided userId)?
- [ ] Am I verifying the user owns the requested data?
- [ ] Am I using early returns for auth failures?

---

## 🎯 Decision Tree: Edit vs. Migrate

```
Is this a .svelte file?
├─ NO → Proceed with TypeScript best practices
└─ YES → Does it use $props() or $state()?
    ├─ YES → It's Svelte 5, use Svelte 5 syntax
    └─ NO → It's Svelte 4
        └─ Did user say "migrate to Svelte 5"?
            ├─ YES → Full migration (see SVELTE5_MIGRATION.md)
            └─ NO → Does task REQUIRE Svelte 5 features?
                ├─ YES → STOP and ask user
                └─ NO → STAY IN SVELTE 4
```

---

## 🔧 Quick Fixes (When Errors Appear)

**If you see parse errors after adding TypeScript:**
→ Add `lang="ts"` to `<script>` tag

**If you see "Not all code paths return a value":**
→ Add `return` statements on all branches

**If you see "Object is possibly undefined":**
→ Add guard: `if (!value) return new Response(..., { status: 400 })`

**If you see "Unreachable code detected":**
→ Remove code after `return` statements

**If you created 10+ new errors:**
→ STOP, revert your changes, reconsider approach

---

## 🚨 When You've Made a Mistake

**If you created errors:**

1. **STOP making more changes**
2. **Don't try to "fix" errors with more edits**
3. **Review what you changed:**
   - Did you forget `lang="ts"`?
   - Did you mix Svelte 4 and Svelte 5 syntax?
   - Did you forget `return` statements?
4. **Consider reverting to original syntax**
5. **Ask the user for guidance**

**Remember:** It's better to ask than to create 50+ cascading errors.

---

## Rule Precedence (Most Important)

When rules conflict, this is the hierarchy (highest to lowest):

1. **SECURITY** ← **ABSOLUTE HIGHEST** - Passwords, financial data, location data
2. **PWA Compliance** ← Can block migration
3. **HTML Living Standard** ← Can block migration
4. **Design System** ← Can block migration
5. Migration Agent Rules
6. Code Style

**If migration conflicts with rules 1-4, DO NOT MIGRATE.**

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
- ✅ ALWAYS add `lang="ts"` when using TypeScript
- ❌ No new Svelte 4 syntax
- ❌ No legacy stores unless interacting with existing ones

---

## Prohibited Behaviors

You MUST NEVER:

❌ **STORE PASSWORDS in plaintext, localStorage, or anywhere insecure**  
❌ **LOG sensitive data (passwords, addresses, dollar amounts)**  
❌ **EXPOSE financial or location data** in logs, errors, or cache  
❌ **USE `{@html}` with user input** (XSS vulnerability)  
❌ **TRUST client-provided userId** in API without verification  
❌ **RETURN data without verifying user owns it**  
❌ Migrate a file just because you're editing it  
❌ Mix Svelte 4 and Svelte 5 syntax in the same file  
❌ Add TypeScript syntax without `lang="ts"`  
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
❌ Try to "fix" TypeScript errors by making more changes  
❌ Leave code after `return` statements (unreachable code)

---

## Required Behaviors

You MUST ALWAYS:

✅ Stop and ask when rules conflict  
✅ Add `lang="ts"` when using TypeScript syntax  
✅ Return `Response` on all code paths in RequestHandlers  
✅ Guard optional/undefined values before passing to functions  
✅ Remove code after `return` statements  
✅ Preserve PWA installability and offline behavior  
✅ Generate valid HTML Living Standard markup  
✅ Use only approved colors from `DESIGN_SYSTEM.md`  
✅ Keep component APIs backward-compatible during migration  
✅ Preserve existing behavior exactly  
✅ Make minimal, localized changes  
✅ Cite specific governance documents when declining requests  
✅ Suggest governance-compliant alternatives  
✅ Read migration annotations (`// MIGRATED_TO_SVELTE_5 - DATE`)  
✅ **Verify user owns data before returning it from API**  
✅ **Never trust client-provided userId - use authenticated user**  
✅ **Sanitize all user input before display**

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

### Scenario 2: User asks to add API endpoint to fetch trips

**CORRECT:**

```typescript
export const GET: RequestHandler = async ({ locals, platform }) => {
	// 1. Auth check with early return
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	// 2. Use authenticated user.id (NEVER client-provided)
	const userId = locals.user.id;

	// 3. Fetch user's data
	const key = `trip:${userId}:`;
	const trips = await platform.env.LOGS.list({ prefix: key });

	// 4. Final return (REQUIRED)
	return new Response(JSON.stringify({ success: true, data: trips }));
};
```

**WRONG:**

```typescript
// DANGEROUS - Multiple issues
export const GET: RequestHandler = async ({ url, platform }) => {
	const userId = url.searchParams.get('userId'); // ❌ Trusts client input

	if (!userId) {
		new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400 });
		// ❌ FORGOT RETURN!
	}

	const trips = await platform.env.LOGS.list({ prefix: `trip:${userId}:` });
	return new Response(JSON.stringify(trips));
	// ❌ No user ownership verification
	// ❌ Could return someone else's data
};
```

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

> I cannot use #FF5722 as it's not in the approved color palette (see DESIGN_SYSTEM.md). The closest approved color is #F68A2E (primary orange). Would you like me to use that instead?

---

### Scenario 4: User asks to display trip addresses in UI

**CORRECT:**

```svelte
<script lang="ts">
	let { address = '' } = $props<{ address?: string }>();
	// Svelte automatically escapes - SAFE
</script>

<p>{address}</p>
```

**WRONG:**

```svelte
<script>
	let { address = '' } = $props();
</script>

<!-- DANGEROUS - XSS vulnerability --><p>{@html address}</p>
```

---

### Scenario 5: User asks to "clean up" or "modernize" old code

**CORRECT:**

> I can see opportunities to modernize this code, but per the governance rules, I should only make changes that are explicitly requested. Would you like me to:
>
> 1. Migrate this specific file to Svelte 5, OR
> 2. Leave it in Svelte 4 and address only the specific issue?

**WRONG:**

- Migrating files without permission
- Refactoring unrelated code
- "Improving" code that works

---

## Quick Reference Card

| Situation                     | Action                                         |
| ----------------------------- | ---------------------------------------------- |
| Fixing bug in Svelte 4 file   | ✅ Fix in Svelte 4, don't migrate              |
| Creating new component        | ✅ Use Svelte 5 with `lang="ts"`               |
| Need a new color              | ❌ STOP - check DESIGN_SYSTEM.md first         |
| Touching service worker       | ❌ STOP - ask before proceeding                |
| User says "modernize this"    | ❌ STOP - ask what specifically to change      |
| Invalid HTML in existing file | ✅ Fix to be valid HTML                        |
| Component needs new prop      | ✅ Add prop in current version (don't migrate) |
| Adding TypeScript syntax      | ✅ MUST add `lang="ts"` to script tag          |
| Creating API endpoint         | ❌ STOP - verify user ownership check          |
| Displaying user input         | ✅ Use `{variable}` NOT `{@html variable}`     |
| RequestHandler function       | ✅ MUST return Response on all paths           |
| Array indexing                | ✅ Guard with check before using               |
| Code after return             | ❌ Remove it (unreachable)                     |
| Created 5+ new errors         | ❌ STOP - don't fix, revert, ask user          |

---

## ✅ Success Criteria

Before marking a task complete:

```bash
npm run check   # TypeScript + Svelte validation
npm run lint    # ESLint
npx eslint .    # Additional linting
```

**If ANY command fails:**

- Your changes are NOT ready
- Review the errors
- Follow the error prevention steps above
- Fix issues before proceeding

**Zero tolerance for:**

- Skipping verification commands
- Committing with TypeScript errors
- Leaving "TODO: fix this later" comments for type issues
- Shipping code that doesn't pass checks
- Partial migrations (mixing Svelte 4/5 syntax)
- Missing `lang="ts"` with TypeScript
- Missing returns in RequestHandlers
- Unreachable code after returns

---

## Migration Progress Tracking

When you migrate a file, add this comment at the top:

```javascript
// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD
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

After making changes, verify:

- **Routes/navigation** → Verify offline mode still works
- **HTML markup** → Verify it's valid (no self-closing non-void elements)
- **Styles** → Verify colors are from approved palette
- **TypeScript files** → Verify `lang="ts"` is present if using types
- **Server routes** → Verify all paths return Response
- **API endpoints** → Verify user ownership checks exist
- **User input display** → Verify using `{variable}` not `{@html variable}`

---

## When in Doubt

**Default behaviors when uncertain:**

1. **Preserve existing behavior** over making changes
2. **Do less** over doing more
3. **Ask** over guessing
4. **Keep Svelte 4** over migrating unnecessarily
5. **Use approved colors** over introducing new ones
6. **Maintain PWA functionality** over new features
7. **Verify user ownership** before returning data
8. **Sanitize input** before displaying
9. **Never trust client data** - always validate server-side
10. **Add `lang="ts"`** when using TypeScript
11. **Return on all paths** in RequestHandlers
12. **Guard before using** optional values

---

## 💡 Key Principles

1. **Do less, not more** → Make minimal changes to accomplish the task
2. **Stay in the current version** → Don't migrate unless requested
3. **Guard before using** → Check undefined values before passing to functions
4. **Return on all paths** → Every RequestHandler needs explicit returns
5. **Add lang="ts" with TypeScript** → Never forget this when adding types
6. **Stop when uncertain** → Better to ask than create cascading errors
7. **Security over convenience** → SECURITY.md rules trump everything

---

## Remember

- This is a **governance-first, security-first, migration-second** project
- Editing ≠ Migrating
- Security, PWA, HTML, and Design System rules trump migration preferences
- When rules conflict, check `GOVERNANCE.md` for precedence
- When uncertain, STOP and ask
- Better to be cautious than to violate governance
- **Always add `lang="ts"` when using TypeScript**
- **Always return Response on all code paths**
- **Always guard optional values before using**
- **Always verify user owns data in API**
- **Never trust client-provided userId**
- **Never mix Svelte 4 and 5 syntax**
- **STOP if you create 5+ errors - don't try to fix them**

**Your goal:** Make Svelte 5 inevitable while respecting all constraints and keeping user data secure.
