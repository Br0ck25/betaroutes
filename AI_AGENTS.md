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

**Also:** Cloudflare KV `list()` results can be a union where `cursor` may be absent when `list_complete: true`.

❌ **Wrong:**

```ts
const list = await kv.list({ prefix, cursor });
cursor = list.cursor; // Error: cursor may not exist / may be undefined
```

✅ **Correct:**

```ts
const list = await kv.list({ prefix, cursor });
cursor = list.list_complete ? undefined : list.cursor; // Guard the union
```

**Prevention:** Treat KV `list()` results as a union. Guard `cursor` with `list_complete` (or check `'cursor' in list`) before reading it.

**Prevention:** **NEVER** import `KVNamespace`, `DurableObject`, or `ExecutionContext`. Use the globals from `app.d.ts`.

---

### Error Pattern #19: Invalid JSON Syntax

**Symptom:** `npm error code EJSONPARSE`, `JSONParseError: Expected ','`
**Cause:** Editing `package.json` or config files and forgetting commas between items.

❌ **Wrong:**

```json
{
  "scripts": {
    "test": "vitest"  // MISSING COMMA
    "format": "prettier"
  }
}
```

✅ **Correct:**

```json
{
	"scripts": {
		"test": "vitest", // Comma added
		"format": "prettier"
	}
}
```

**Prevention:** Always validate JSON syntax (commas and braces) before outputting config files.

---

### Error Pattern #21: Index Signature Access

**Symptom:** `Property 'X' comes from an index signature, so it must be accessed with ['X']`
**Cause:** Accessing properties via dot notation (`env.KEY`) on an object typed as a generic record (e.g., `Env` or `Record<string, any>`).

❌ **Wrong:**

```ts
// If env is typed as Record<string, KVNamespace>
await env.BETA_LOGS_KV.put(/* ... */); // TS Error
```

✅ **Correct:**

```ts
// Option A: Use brackets
await env['BETA_LOGS_KV'].put(/* ... */);

// Option B (Preferred): Cast to specific type
const specificEnv = env as { BETA_LOGS_KV: KVNamespace };
await specificEnv.BETA_LOGS_KV.put(/* ... */);
```

**Prevention:** If an object has an index signature, use `['bracket']` notation or cast it to a strict interface.

---

### Error Pattern #22: Lazy Typing (Explicit Any)

**Symptom:** `Unexpected any. Specify a different type @typescript-eslint/no-explicit-any`
**Cause:** Using `any` to silence TypeScript instead of defining a proper interface or using `unknown`.

❌ **Wrong:**

```ts
function handleData(data: any) {
	// Lazy!
	return (data as any).id;
}
```

✅ **Correct:**

```ts
// Option A: Define the shape (Preferred)
function handleData(data: { id: string }) {
	return data.id;
}

// Option B: Use 'unknown' and narrow (Safe fallback)
function handleData(data: unknown) {
	if (typeof data === 'object' && data !== null && 'id' in data) {
		return (data as { id: string }).id;
	}
	throw new Error('Invalid data shape');
}
```

**Prevention:** **NEVER** use `any`. Use `unknown` if the type is truly dynamic, then validate it.

---

---

### Error Pattern #23: Missing CSRF Headers in Client Fetch

**Symptom:** `403 Forbidden`, `CSRF validation failed` in console.
**Cause:** Generating manual `fetch()` calls without the `x-csrf-token` header.

❌ **Wrong:**

```js
await fetch('/api/update', {
	method: 'POST',
	body: JSON.stringify(data)
}); // Fails: No CSRF token
```

✅ **Correct:**

```js
await fetch('/api/update', {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		'x-csrf-token': document.querySelector('meta[name="csrf-token"]').content
		// OR pass the token variable if available in scope
	},
	body: JSON.stringify(data)
});
```

**Prevention:** All manual `fetch()` calls to mutation endpoints **MUST** include `x-csrf-token`.

### Error Pattern #24: Function Signature Mismatch

**Symptom:** `Expected X arguments, but got Y`, `Argument of type '...' is not assignable to parameter`
**Cause:** Guessing a function's arguments based on similar functions instead of reading the actual definition.

❌ **Wrong:**

```ts
// Guessing that listTrash takes 'legacyName' because list() does
await service.listTrash(id, legacyName); // Error!
```

✅ **Correct:**

```ts
// 1. Read the definition of listTrash() first
// 2. Call it correctly
await service.listTrash(id);
```

**Prevention:** **NEVER** guess arguments. If you import a function, you **MUST** read its definition file first.

---

### Error Pattern #25: Broken Control Flow (Syntax Collapse)

**Symptom:** `'try' expected`, `'catch' or 'finally' expected`, `'}' expected`
**Cause:** Opening a `try` block without a matching `catch`/`finally`, or losing track of closing braces during an edit.

❌ **Wrong:**

```ts
try {
  await doWork();
  // ERROR: Missing catch/finally and closing brace!
```

✅ **Correct:**

```ts
try {
	await doWork();
} catch (err) {
	log.error('Error', { err });
	return error(500);
}
```

**Prevention:** When writing control flow, write the skeleton first (`try {} catch {}`), then fill it in. Count your braces.

---

### Error Pattern #26: Incomplete Test Context (Missing Mocks)

**Symptom:** `TypeError: kv.get is not a function`, `Cannot read properties of undefined (reading 'put')` in `vitest` logs.
**Cause:** Invoking a SvelteKit handler in a test without mocking the `platform.env` bindings.

❌ **Wrong:**

```ts
// Test file
const event = { locals: { user } } as RequestEvent; // Missing platform!
await POST(event); // Crashes because env.KV is missing
```

✅ **Correct:**

```ts
// Test file
import { createMockKV } from '$lib/server/mockKv'; // Use your mock helper

const event = {
	locals: { user },
	platform: {
		env: {
			USERS_KV: createMockKV() // Explicitly provide the KV mock
			// ... other bindings
		}
	}
} as unknown as RequestEvent;

await POST(event);
```

**Prevention:** When testing `+server.ts` files, you **MUST** construct a full `platform.env` object with valid mocks for every KV/DO used.

---

### Error Pattern #27: Strict Union Assignment

**Symptom:** `Type 'string | undefined' is not assignable to type 'string'`.
**Cause:** Assigning an optional value (like `cursor`) to a mandatory field without a fallback.

❌ **Wrong:**

```ts
interface State {
	cursor: string;
}
state.cursor = result.cursor; // Error: result.cursor might be undefined
```

✅ **Correct:**

```ts
// Option A: Allow undefined in interface
interface State {
	cursor?: string;
}

// Option B: Provide default
state.cursor = result.cursor ?? '';
```

**Prevention:** Always check if a source value is optional before assigning it to a strict target.

---

### Error Pattern #28: Lazy Variable Declaration (Prefer Const)

**Symptom:** `error 'x' is never reassigned. Use 'const' instead`
**Cause:** Defaulting to `let` for variables that are never mutated.

❌ **Wrong:**

```ts
let userId = event.locals.user.id; // Error: userId never changes
let config = {
	/* ... */
};
```

✅ **Correct:**

```ts
const userId = event.locals.user.id;
const config = {
	/* ... */
};
```

**Prevention:** Always use `const` by default. Only use `let` if you explicitly intend to reassign the variable.

---

### Error Pattern #29: Forbidden TS Ignore

**Symptom:** `Use "@ts-expect-error" instead of "@ts-ignore"`
**Cause:** Using `@ts-ignore` to silence TypeScript errors.

❌ **Wrong:**

```ts
// @ts-ignore
const res = await POST(event as any);
```

✅ **Correct:**

```ts
// @ts-expect-error - Testing invalid input handling
const res = await POST(event as any);
```

**Prevention:** **NEVER** use `@ts-ignore`. If you must suppress an error (e.g., in tests), use `@ts-expect-error` and add a comment explaining why.

---

### Error Pattern #30: The Cloudflare Cursor Trap

**Symptom:** `Property 'cursor' does not exist on type 'KVNamespaceListResult<...>'`
**Cause:** Trying to access `list.cursor` directly. In Cloudflare types, if `list_complete` is true, the `cursor` property does not exist on the type union.
**Prevention:** You **MUST** guard access to the cursor or check `list_complete` first.

❌ **Wrong:**

```ts
return { cursor: list.cursor }; // TS Error: cursor might not exist
```

✅ **Correct:**

```ts
// Check list_complete first
const cursor = list.list_complete ? undefined : list.cursor;
return { cursor };
```

---

### Error Pattern #31: Mock Drift (Incomplete Mocks)

**Symptom:** `TypeError: kv.get is not a function` or `mock.get is undefined` in tests.
**Cause:** Creating a mock object that only implements part of the interface (e.g., only `put`) when the code under test calls other methods (e.g., `get` or `getWithMetadata`).
**Prevention:** When mocking a service or KV, strictly define **ALL** methods used by the function under test, or use a factory that provides safe defaults for everything.

❌ **Wrong:**

```ts
// Code calls kv.get(), but mock only has put
const mockKV = { put: vi.fn() };
```

✅ **Correct:**

```ts
// Provide defaults for all used methods
const mockKV = {
	put: vi.fn(),
	get: vi.fn().mockResolvedValue(null),
	getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null })
};
```

---

### Error Pattern #32: The "Zombie" Variable (Unused Args)

**Symptom:** `'e' is defined but never used`, `'_env' is defined but never used`.
**Cause:** Declaring variables in `catch` blocks or function arguments “just in case” they are needed later.
**Prevention:** If a variable is not used, delete it. Do **not** just prefix it with `_`.

❌ **Wrong:**

```ts
catch (e) { return null; } // 'e' is unused
const run = async (_env) => { /* ... */ } // '_env' is unused
```

✅ **Correct:**

```ts
catch { return null; } // Optional catch binding (ES2019)
const run = async () => { /* ... */ } // Remove the argument entirely
```

---

### Error Pattern #33: The CommonJS Relic

**Symptom:** A `require()` style import is forbidden.
**Cause:** Using Node.js `require()` in tools/scripts instead of ES Module syntax. Your project is `type: module`.
**Prevention:** Always use `import` / `export`, even in standalone scripts.

❌ **Wrong:**

```js
const fs = require('fs');
module.exports = {
	/* ... */
};
```

✅ **Correct:**

```js
import fs from 'fs';
export default {
	/* ... */
};
```

---

### Error Pattern #34: Console Pollution

**Symptom:** `Unexpected console statement.`
**Cause:** Leaving debugging logs (`console.log`) in the code.
**Prevention:** Use the application logger (`$lib/server/log`) for persistent logs, or remove the log entirely.

❌ **Wrong:**

```ts
console.log('Migrating user...', userId);
```

✅ **Correct:**

```ts
import { log } from '$lib/server/log';
log.info('Migrating user', { userId });
```

---

### Error Pattern #35: Type Definition Desync

**Symptom:** `Property 'x' does not exist on type 'Y'`, but you are sure `x` exists in the database/logic.
**Cause:** Updating the code to use a new property (e.g., `user.name`) without updating the central type definition (e.g., `app.d.ts` or `types.ts`).

❌ **Wrong:**

```ts
// Code
const name = user.name; // Error: Property 'name' does not exist on type 'SessionUser'
```

✅ **Correct:**

Update the type definition first:

```ts
// app.d.ts
interface SessionUser {
	id: string;
	name?: string; // Add the missing property
}
```

Then update the code:

```ts
const name = user.name; // Now valid
```

**Prevention:** Before using a new property on a shared type (User, Trip, Session), verify and update its interface definition first.

## System Prompt Additions (Paste-into-Chat Guardrails)

Add these lines to your chat/system prompt under **STRICT NON-NEGOTIABLES**:

1. **DATA ISOLATION:** Every KV write MUST include `userId` in the key. No global cache.
2. **NO BACKDOORS:** Do not create `debug/*` or `test/*` routes.

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
