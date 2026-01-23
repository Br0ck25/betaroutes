# AI Agent Instructions

**CRITICAL:** You are working on a governed codebase with strict, non-negotiable rules.

**⚠️ This application handles sensitive data:** passwords, financial information, trip addresses, and personal data.

---

## ⚠️ READ THESE FIRST (MANDATORY)

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

## 🛑 STOP CONDITIONS (Mandatory)

**STOP and ask the user before proceeding if:**

1. **Migration decision required**
   - You’re about to change a Svelte 4 file that uses `export let`, `$:`, or `<slot>`
   - The user did **NOT** explicitly request migration to Svelte 5
   - The task can be completed in Svelte 4 syntax

2. **New `npm run check` / lint errors after your changes**
   - Your changes would introduce **NEW** errors (TypeScript / Svelte diagnostics / ESLint)
   - **DO NOT** try to “fix” these errors by making more changes
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

## ⚠️ CRITICAL ERRORS TO AVOID

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

### Error Pattern #2: Partial Migration (Svelte 4 + 5 Mix)

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

### Error Pattern #3: Server Routes Missing Returns

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

### Error Pattern #4: Passing Possibly Undefined Values

**Symptom:** `Object is possibly 'undefined'`, `Operator '<' cannot be applied to types ... and 'undefined'`
**Cause:** Passing array elements or using optional values in comparisons without checking.

❌ **Wrong:**

```ts
// Array Indexing
const item = items[index]; // Error: index might be -1

// Comparisons
if (user.age > 18) { ... } // Error: user.age might be undefined
```

✅ **Correct:**

```ts
// Array Indexing
if (index === -1) return;
const item = items[index]!;

// Comparisons
if (user.age && user.age > 18) { ... } // Guard added
```

**Prevention:** Always guard array indexing and optional values before passing to functions or operators.

---

### Error Pattern #5: Unreachable Code

**Symptom:** `Unreachable code detected`
**Cause:** Code placed after a `return` statement

❌ **Wrong:**

```ts
if (error) {
	return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
	assignments[idx].stops.push(stop); // UNREACHABLE!
}
```

✅ **Correct:**

```ts
if (error) {
	console.error('Failed:', error);
	return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
}

assignments[idx].stops.push(stop); // Reachable
```

**Prevention:** Never place code after a `return` statement.

---

### Error Pattern #6: Unused / Speculative State (Clean Code)

**Symptom:** `'selectedMileage' is declared but its value is never read`
**Cause:** Declaring variables "just in case," or destructuring unused SvelteKit parameters (e.g., `platform`, `url`) in load functions.

❌ **Wrong:**

```ts
let selectedMileage = new Set<string>(); // Unused -> lint/check error
```

✅ **Correct:**

- Do **not** declare it until you write the code that uses it.
- If a variable/arg must exist for signature reasons, prefix with `_` (e.g. `_req`, `_unusedIndex`).

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #7: Missing Imports & Exports

**Symptom:** `Cannot find name 'createEventDispatcher'`, `declares 'x' locally but it is not exported`
**Cause:** Using standard Svelte functions without importing them, or creating utility functions without exporting them.

❌ **Wrong:**

```ts
// in utils/dates.ts
function parseToDate(d) {
	// ...
} // Not exported!

// in Component.svelte (Svelte 4)
const dispatch = createEventDispatcher(); // Not imported!
```

✅ **Correct:**

```ts
// in utils/dates.ts
export function parseToDate(d) {
	// ...
} // Exported

// in Component.svelte (Svelte 4)
import { createEventDispatcher } from 'svelte';
const dispatch = createEventDispatcher();
```

---

### Error Pattern #8: Type & Signature Hallucinations

**Symptom:** `Property 'id' does not exist on type 'User'`, `Expected 3 arguments, but got 6`

**Cause:** Guessing types or utility function signatures instead of reading the definition.

❌ **Wrong:**

```ts
// Guessing that 'checkRateLimit' takes an IP address and 6 args
checkRateLimit(kv, userId, ip, 'action', 10, 60);

// Guessing that 'user' has an 'id' field without checking app.d.ts
const id = locals.user.id;
```

✅ **Correct:**

```ts
// Checked actual signature: checkRateLimit(kv, id, action, limit, window)
checkRateLimit(kv, userId, 'action', 10, 60);

// Checked app.d.ts: User has 'token' but not 'id'?
// Either update app.d.ts OR use the correct field.
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #9: Incomplete Form Error Handling

**Symptom:** `Property 'email' does not exist on type '{ error: string }'` in a `.svelte` file.

**Cause:** The Svelte page tries to repopulate form fields (`value={form?.email}`), but the server `fail()` return only contains the error message.

❌ **Wrong:**

```ts
// +page.server.ts
if (!email) return fail(400, { error: 'Missing email' });

// +page.svelte
<input value={form?.email} /> // Error! 'email' is undefined on error.
```

✅ **Correct:**

```ts
// +page.server.ts
if (!email) return fail(400, { error: 'Missing email', email }); // Return the data!

// +page.svelte
<input value={form?.email ?? ''} /> // Works.
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

## 🛡️ SECURITY ERROR PATTERNS (Audit Remediation)

### Error Pattern #10: Insecure ID Fallback (ATO Risk)

**Symptom:** Vulnerability allowing Account Takeover if `user.id` is missing.
**Cause:** Falling back to insecure fields (`name`, `token`, `email`) when an ID is undefined.

❌ **Wrong:**

```ts
// DANGEROUS: If id is missing, it returns the name or token!
// A user named "admin" could steal the admin account.
return user?.id || user?.name || user?.token || '';
```

✅ **Correct:**

```ts
// STRICT: Only accept the true ID. If missing, fail secure.
if (!user?.id) throw new Error('User ID missing');
return user.id;
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #11: Mass Assignment (Data Injection)

**Symptom:** Users registering with `{ "role": "admin" }` or overwriting protected fields.
**Cause:** Spreading `...body` directly into database/KV objects.

❌ **Wrong:**

```ts
const body = await request.json();
// DANGEROUS: User can send ANY field (e.g., is_admin: true)
const newUser = { ...body, id: crypto.randomUUID() };
```

✅ **Correct:**

```ts
const body = await request.json();
// STRICT: Only extract exactly what is allowed
const newUser = {
	id: crypto.randomUUID(),
	email: body.email,
	name: body.name
	// Explicitly do NOT copy other fields
};
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #12: Global Data Leaks (Cache Poisoning)

**Symptom:** User A sees User B’s autocomplete data or recent trips.
**Cause:** Writing user-specific data to a global KV key or variable.

❌ **Wrong:**

```ts
// DANGEROUS: Shared across ALL users
await env.PLACES_KV.put('recent_places', JSON.stringify(places));
```

✅ **Correct:**

```ts
// STRICT: Key MUST be scoped to the specific user
await env.PLACES_KV.put(`places:${userId}`, JSON.stringify(places));
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #13: Hardcoded Secrets

**Symptom:** Secrets committed to `wrangler.toml` or code.
**Cause:** Convenience during development.

❌ **Wrong:**

```ts
const STRIPE_KEY = 'sk_live_...'; // Committed to git!
// OR in wrangler.toml:
// [vars]
// API_KEY = "secret"
```

✅ **Correct:**

```ts
// Code:
const key = env.STRIPE_KEY; // Loaded from environment

// Infrastructure:
// Run: wrangler secret put STRIPE_KEY
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #14: Creating "Debug" Backdoors

**Symptom:** Routes like `/api/debug/wipe-db` or `/debug/seed`.
**Cause:** Creating “helper” endpoints for testing that bypass security.

❌ **Wrong:**

```ts
// src/routes/api/debug/+server.ts
export const POST = async ({ platform }) => {
	await platform.env.KV.empty(); // DATA DESTRUCTION RISK
	return json({ success: true });
};
```

✅ **Correct:**

- Do not create debug routes.
- Use unit tests or local scripts for seeding data.
- If testing is needed, use `vitest` with mock data, not live endpoints.

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #15: Untyped State / Store Initialization

**Symptom:** `Property 'id' does not exist on type 'never'`, `Variable implicitly has an 'any' type`
**Cause:** Initializing state, arrays, or stores with `null` or `[]` but no generic type.

❌ **Wrong:**

```ts
// TypeScript infers 'never[]' or 'null'
let items = $state([]);
const activeUser = writable(null);
```

✅ **Correct:**

```ts
// Explicitly define the type
let items = $state<Item[]>([]);
const activeUser = writable<User | null>(null);
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #16: Insecure Logic Fallbacks (IDOR Risk)

**Symptom:** Ownership checks use `user.name` or `user.email` instead of `user.id`
**Cause:** Trying to "fix" a missing ID by checking other fields.

❌ **Wrong:**

```ts
// SECURITY RISK: Names are not unique/immutable
if (trip.userId === user.name) {
	// ...
}
```

✅ **Correct:**

```ts
// STRICT: ID check only.
if (trip.userId !== user.id) return error(403);
```

**Prevention:** Run `npm run lint` before showing the code. If you delete logic, you MUST delete the imports and variables that supported it. Zero tolerance for unused code.

---

### Error Pattern #17: Structural Nesting & Scope

**Symptom:** `Modifiers cannot appear here`, `Cannot find name 'x'` (when 'x' is clearly defined above), `Error: '}' expected`.
**Cause:** Defining utility functions _inside_ the main handler function, or losing track of closing brackets `}`.

❌ **Wrong:**

```ts
export async function mainHandler() {
	// ... logic ...

	// ERROR: Nested export!
	export async function helper() {
		/* ... */
	}
}
```

✅ **Correct:**

```ts
// Define helpers at the TOP LEVEL
async function helper() {
	/* ... */
}

export async function mainHandler() {
	await helper();
}
```

**Prevention:** All helper functions must be defined at the top level of the file, never nested inside other functions.

---

### Error Pattern #18: Cloudflare Type Conflicts

**Symptom:** `Type 'KVNamespace' is not assignable to type 'KVNamespace'.`
**Cause:** Manually importing types from `@cloudflare/workers-types` instead of using the global ambient types.

❌ **Wrong:**

```ts
import { KVNamespace } from '@cloudflare/workers-types'; // CONFLICT!
function save(kv: KVNamespace) {
	/* ... */
}
```

✅ **Correct:**

```ts
// Use the global type (no import needed)
function save(kv: KVNamespace) {
	/* ... */
}
```

**Prevention:** **NEVER** import `KVNamespace`, `DurableObject`, or `ExecutionContext`. Use the globals from `app.d.ts`.

## System Prompt Additions (Paste-into-Chat Guardrails)

Add these lines to your chat/system prompt under **STRICT NON-NEGOTIABLES**:

1. **DATA ISOLATION:** Every KV write MUST include `userId` in the key. No global cache.
2. **NO BACKDOORS:** Do not create `debug/*` or `test/*` routes.
3. **EXPLICIT ASSIGNMENT:** Never use `...body` for DB writes. Destructure fields manually.

---

## Error Handling & Logging (Mandatory)

### 1. Server-Side Code (`+server.ts`, API routes, server utilities)

**Rule:** You **MUST** log errors. Never swallow exceptions silently.

❌ **Never ignore without logging:**

```ts
try {
	await riskyOperation();
} catch (e) {
	// ESLint: unused variable + silent failure
	return fallbackValue;
}
```

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

### 2. Client-Side & Intentional Silence

**Rule:** If an error variable is genuinely not needed (e.g., in a UI utility or optional parsing), handle it cleanly.

**A. Catch Blocks (Preferred):**
Use **Optional Catch Binding** (`catch {}`) when the error object is unused.

```ts
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

```ts
items.map((_item, index) => index);
```

**ESLint reminder:** Ensure your ESLint config ignores unused variables/args starting with `_`, or `@typescript-eslint/no-unused-vars` will still fail.

---

### Critical: Don’t Delete Actual Operations

When adding error logging, do **not** accidentally delete the operation itself.

✅ Keep the original operation and add logging around it. Never “refactor away” the failing call.

---

## 📋 Pre-Flight Checklist (Before Making ANY Change)

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

```js
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
- Create **"Debug"** or **"Test"** endpoints (e.g., `/api/debug/*`) that bypass auth or manipulate data
- Use **fallbacks** for user IDs (e.g., `user.id || user.name`)
- Spread request body (`...body`) directly into storage objects (mass assignment)
- Write to **global KV keys** without a `${userId}` prefix
- Hardcode secrets in code or configuration files
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

## Remember

This is a **governance-first, security-first, migration-second** project.

**Editing ≠ migrating.**
When in doubt: **do less** and **ask**.
