# AI Agent Instructions

**CRITICAL:** You are working on a governed codebase with strict, non-negotiable rules.

**⚠️ This application handles sensitive data:** passwords, financial information, trip addresses, and personal data.

---

## ⚠️ Read These First (Mandatory)

Before making **ANY** changes, read these documents **in order**:

1. **`SECURITY.md`** — **READ FIRST** (security has absolute highest priority)
2. **`GOVERNANCE.md`** — rule hierarchy and conflict resolution
3. **`AI_AGENTS.md`** — this file (quick reference + error prevention)
4. **`SVELTE5_STANDARDS.md`** — standards for **new** Svelte 5 files only
5. **`SVELTE5_MIGRATION.md`** — migration rules (only when migrating)
6. **`PWA.md`** — PWA requirements (**higher precedence than migration**)
7. **`HTML_LIVING_STANDARD.md`** — HTML syntax rules (**higher precedence than migration**)
8. **`DESIGN_SYSTEM.md`** — color palette (**higher precedence than migration**)

---

## 🛑 Stop Conditions (Mandatory)

**STOP and ask the user before proceeding if:**

1. **Migration decision required**
   - You’re about to change a Svelte 4 file that uses `export let`, `$:`, or `<slot>`
   - The user did **NOT** explicitly request migration to Svelte 5
   - The task can be completed in Svelte 4 syntax

2. **New `npm run check` / lint errors after your changes**
   - Your changes would introduce **NEW** errors (TypeScript / Svelte diagnostics / ESLint)
   - **Do NOT** try to “fix” these errors by making more changes
   - **STOP**, review your diff, consider reverting, ask the user if the approach is correct

3. **Security impact**
   - Any change touching authentication, passwords, sessions, or user data access
   - Any change to API endpoints that return user data
   - Any change to KV key patterns or data access logic

4. **Architectural changes**
   - Multiple ways to solve a problem exist
   - Breaking changes to public APIs
   - Service worker or PWA manifest modifications
   - Routing changes that might affect offline behavior

5. **Governance conflicts / uncertainty**
   - Non-approved colors would be introduced
   - Invalid HTML would be generated
   - You’re unsure about any governance rule or precedence

---

## ⚠️ Critical Errors to Avoid

### Error Pattern #1: Forgetting `lang="ts"`

**Symptom:** 50+ parse errors like `'<` cannot be applied to types, `'string'` only refers to a type
**Cause:** Added TypeScript syntax without `lang="ts"`

❌ **Wrong:**

```svelte
<script>
	let items = $state<Item[]>([]); // Parse error (TypeScript without lang="ts")
</script>
```

✅ **Correct:**

```svelte
<script lang="ts">
	let items = $state<Item[]>([]);
</script>
```

**Prevention:** If you add **ANY** TypeScript syntax (`: Type`, `<Type>`, `interface`, `type`), you **MUST** add `lang="ts"`.

---

### Error Pattern #2: Partial Migration (Svelte 4 + 5 mix)

**Symptom:** File uses both `export let` **and** `$state()`, errors everywhere
**Cause:** Attempted to add Svelte 5 features to a Svelte 4 file

❌ **Wrong:**

```svelte
<script>
	export let title; // Svelte 4
	let count = $state(0); // Svelte 5 (CONFLICT)
</script>
```

✅ **Correct:** Either stay fully Svelte 4, **or** migrate the entire file to Svelte 5.

**Prevention:** Before touching a `.svelte` file, ask:

1. Is this file already Svelte 5? (uses `$props()`, `$state()`, `$derived()`)
2. Did the user request migration?
3. Can I complete this task in the current version?

If **NO** to questions 2–3, **stay in the current version**.

---

### Error Pattern #3: Server routes missing returns

**Symptom:** `Not all code paths return a value`, `Type 'undefined' is not assignable to type 'Response'`
**Cause:** `RequestHandler` does not `return` a `Response` on every path

❌ **Wrong:**

```ts
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
		// Forgot `return`
	}

	// Do something...
	// Forgot final return
};
```

✅ **Correct:**

```ts
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	const result = await doSomething();
	return new Response(JSON.stringify({ success: true, data: result }));
};
```

**Prevention:** Every `RequestHandler` must `return` on every code path.

---

### Error Pattern #4: Unguarded Optional Values

**Symptom:** `Object is possibly 'undefined'`, `Operator '<' cannot be applied to types ... and 'undefined'`
**Cause:** Using optional values in comparisons, math, or array indexing without checking if they exist first.

❌ **Wrong:**

````typescript
// Array Indexing
const item = items[index]; // Error: index might be -1

// Comparisons
if (user.age > 18) { ... } // Error: user.age might be undefined

✅ **Correct:**

// Array Indexing
if (index === -1) return;
const item = items[index];

// Comparisons
if (user.age && user.age > 18) { ... } // Guard added

---

### Error Pattern #5: Unreachable code

**Symptom:** `Unreachable code detected`
**Cause:** Code placed after a `return`

❌ **Wrong:**

```ts
if (error) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
    assignments[idx].stops.push(stop); // unreachable
}
````

✅ **Correct:**

```ts
if (error) {
	return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
}

assignments[idx].stops.push(stop);
```

**Prevention:** Never place code after a `return`.

---

### Error Pattern #6: Unused / speculative state (clean code)

**Symptom:** `'selectedMileage' is declared but its value is never read`
**Cause:** Declaring variables/state “just in case” (unused)

❌ **Wrong:**

```ts
let selectedMileage = new Set<string>(); // unused -> check/lint error
```

✅ **Correct:**

- Do **not** declare it until you write the code that uses it.
- If a variable/arg must exist for signature reasons, prefix with `_` (e.g. `_req`, `_unusedIndex`).

**Prevention:** Make the smallest diff possible. Do not add placeholder code.

### Error Pattern #7: Missing Imports & Exports (Lazy Coding)

**Symptom:** `Cannot find name 'createEventDispatcher'`, `declares 'x' locally but it is not exported`

**Cause:** Using standard Svelte functions without importing them, or creating utility functions without making them public.

❌ **Wrong:**

````typescript
// in utils/dates.ts
function parseToDate(d) { ... } // Not exported!

// in Component.svelte (Svelte 4)
const dispatch = createEventDispatcher(); // Not imported!

✅ **Correct:**

// in utils/dates.ts
export function parseToDate(d) { ... } // Export added

// in Component.svelte (Svelte 4)
import { createEventDispatcher } from 'svelte'; // Import added
const dispatch = createEventDispatcher();

---

## Error Handling & Logging (Mandatory)

### Server-side code (`+server.ts`, API routes, server utilities)

**Rule:** You **MUST** log errors. Never swallow exceptions silently.

❌ **Never ignore without logging:**

```ts
try {
    await riskyOperation();
} catch (e) {
    // ESLint: unused variable + silent failure
    return fallbackValue;
}
````

✅ **Always log errors in server code (do not log sensitive data):**

```ts
try {
	await riskyOperation();
} catch (e) {
	log.warn('[CONTEXT] Operation failed', { err: (e as Error).message });
	return fallbackValue;
}
```

✅ **Only use underscore prefix for truly intentional silence (rare):**

```ts
try {
	JSON.parse(maybeJson);
} catch (_e) {
	// Optional parsing expected to fail sometimes
	return null;
}
```

---

### Client-Side & Intentional Silence

**Rule:** If an error variable is genuinely not needed (e.g., in a UI utility or optional parsing), handle it cleanly.

**A. Catch Blocks (Preferred):**
Use **Optional Catch Binding** (`catch {}`) when the error object is unused.

```typescript
// ✅ PREFERRED (Client-side only)
try {
	JSON.parse(userInput);
} catch {
	// No variable created, no lint error
	resetForm();
}
```

**B. Function Parameters:**
Use the underscore prefix (`_`) for unused arguments.

```typescript
items.map((_item, index) => index);
```

**Note:** Ensure ESLint is configured to ignore unused variables/args that start with `_`, or this will still fail `@typescript-eslint/no-unused-vars`.

---

### Critical: Don’t delete actual operations

When adding error logging, do **not** accidentally delete the operation itself.

❌ **Wrong (deleted KV read):**

```ts
try {
	if (kv) {
		const raw = await kv.get(key);
		if (raw) return JSON.parse(String(raw));
	}
} catch (e) {
	log.warn('[CACHE] Read failed', { key, err: (e as Error).message });
}
```

✅ **Correct:**

```ts
try {
	if (kv) {
		const raw = await kv.get(key);
		if (raw) return JSON.parse(String(raw));
	}
} catch (e) {
	log.warn('[CACHE] Read failed', { key, err: (e as Error).message });
}
```

---

### Server logging best practices

✅ Include context:

```ts
log.warn('[ROUTE CACHE] Read failed', { key: cacheKey, err: (e as Error).message });
```

✅ Use appropriate log levels:

- `log.info()` — normal milestones
- `log.warn()` — recoverable failures (fallback used)
- `log.error()` — serious failures / data integrity risk

🚫 Never log sensitive data:

- passwords, tokens
- full addresses
- dollar amounts
- raw payloads
- user identifiers (unless SECURITY.md explicitly allows a safe form)

---

## 📋 Pre-flight Checklist (Before Making Any Change)

### For `.svelte` files

- [ ] Is this file Svelte 4 or Svelte 5?
  - Svelte 5: `$props()`, `$state()`, `$derived()`
  - Svelte 4: `export let`, `$:`, `<slot>`
- [ ] Did the user explicitly request migration?
  - **No** → stay in current version
- [ ] Am I adding TypeScript syntax?
  - **Yes** → must add `<script lang="ts">`
- [ ] Am I changing event handlers?
  - Svelte 5 → `onclick`, `oninput`, etc.
  - Svelte 4 → `on:click`, `on:input`, etc.

### For `+server.ts` / RequestHandlers

- [ ] Every code path returns a `Response`
- [ ] Early returns use `return new Response(...)`
- [ ] No code after `return`
- [ ] Guard optional/undefined values
- [ ] Auth uses `locals.user` (never client-provided userId)
- [ ] Verify user ownership before returning data
- [ ] Errors are logged (without sensitive details)

---

## 🎯 Decision Tree: Edit vs. Migrate

```text
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

## Migration Progress Tracking

When you successfully migrate a file to Svelte 5, you **MUST** add this comment at the top of the file:

```javascript
// MIGRATED_TO_SVELTE_5 - YYYY-MM-DD
```

Never remove these annotations from existing files.

---

## Long Log Lists in a PWA (Trips / Expenses / Mileage)

**Default recommendation:** cursor-based pagination + **Load more** + list virtualization.

Why:

- Better scroll restoration when opening an item and returning
- Better offline behavior (bounded chunks)
- Better memory/performance on mobile
- Better accessibility than “endless append”

**Avoid pure infinite scroll** unless you also implement:

- virtualization
- scroll restoration
- a fallback “Load more” control
- a “Back to top” control

If multiple list architectures are viable, **STOP and ask** before changing the UX.

---

## 🔧 Quick Fixes (When Errors Appear)

- **Parse errors after adding TypeScript:** add `lang="ts"` to `<script>`
- **Not all code paths return:** add `return` on all branches in RequestHandlers
- **Possibly undefined:** add guards before using values
- **Unreachable code:** remove code after `return`
- **Unused vars/imports:** delete them; if truly required but unused, prefix with `_`
- **Created 5+ new errors:** STOP, revert, reconsider, ask the user

---

## Rule Precedence (Most Important)

When rules conflict, use this hierarchy (highest to lowest):

1. **SECURITY** — absolute highest
2. **PWA compliance** — can block migration
3. **HTML Living Standard** — can block migration
4. **Design System** — can block migration
5. Migration rules
6. Code style

If migration conflicts with rules 1–4, **do not migrate**.

---

## Prohibited Behaviors (Zero Tolerance)

You MUST NEVER:

- Store passwords in plaintext (including localStorage)
- Log sensitive data (passwords, addresses, dollar amounts, tokens)
- Expose financial or location data in logs/errors/cache
- Use `{@html}` with user input
- Trust client-provided `userId` in server APIs
- Return data without verifying user ownership
- Migrate a file just because you’re editing it
- Mix Svelte 4 and Svelte 5 syntax in the same file
- Add TypeScript syntax without `lang="ts"`
- Introduce colors outside the approved palette
- Break PWA offline functionality
- Generate invalid HTML (`<div />` etc.)
- Modify `manifest.json` / service worker without explicit approval
- Create “fix loops” (adding more code to patch new errors)
- Leave unused variables/imports/speculative state in committed code

---

## Required Behaviors

You MUST ALWAYS:

- Stop and ask when rules conflict or you’re unsure
- Preserve existing behavior unless explicitly requested
- Keep diffs small and localized
- Use only approved colors from `DESIGN_SYSTEM.md`
- Produce valid HTML per `HTML_LIVING_STANDARD.md`
- Preserve PWA installability + offline behavior (`PWA.md`)
- For RequestHandlers: return `Response` on all code paths
- Guard optional/undefined values before use
- Verify user ownership on all user-data APIs
- Log server-side errors (without sensitive details)

---

## ✅ Success Criteria

Before marking a task complete:

```bash
npm run check   # TypeScript + Svelte validation (must pass)
npm run lint    # ESLint (must pass)
npx eslint .    # Additional linting (must pass)
```

If any command fails:

1. STOP
2. Review your diff
3. Fix the root cause (don’t pile on “fixes”)
4. Ask the user if there’s any uncertainty

---

## Reminder

This is a **governance-first, security-first, migration-second** project.

**Editing ≠ migrating.**
When in doubt: **do less** and **ask**.
