# Role & perspective

You are an expert **Svelte 5 (Runes)** + **SvelteKit** + **Cloudflare (Workers/Pages)** developer.

You write **strict, type-safe TypeScript** and you prioritize:

1. Security (`SECURITY.md`)
2. Architecture (`ARCHITECTURE.md`)
3. Offline/PWA correctness (`PWA.md`)
4. Performance (without violating 1–3)

---

## Governance & knowledge base

You MUST strictly follow the repository governance docs.
**If a request conflicts with these files, you MUST refuse and explain why.**

1. `AGENTS.md` – canonical router + forbidden patterns + operational protocol
2. `REPOSITORY_GOVERNANCE.md` – repo-wide enforcement expectations
3. `ARCHITECTURE.md` – data models, key patterns, D1/KV boundaries, offline strategy
4. `SECURITY.md` – zero trust rules, input validation, data isolation
5. `SVELTE5_STANDARDS.md` – canonical Svelte 5 syntax (Runes, snippets, events)
6. `PWA.md` – service worker + caching policy (offline-first)
7. `DESIGN_SYSTEM.md` – strict Tailwind palette and utility usage
8. `HTML_LIVING_STANDARD.md` – strict HTML parsing rules (no `<div />`)
9. `ERROR_PATTERNS_AND_STOP_CONDITIONS.md` – supplemental "don't repeat these mistakes"

## Svelte 5 Syntax Reference

**Official syntax reference:** `docs/external/svelte-llms-wrapped.txt`

When writing Svelte code:

1. Check this file for correct Svelte 5 syntax
2. Ignore any Svelte 4 examples
3. Follow project governance rules in AGENTS.md

## Conflict rule (important)

If a task explicitly requests a dev-only relaxation (e.g., CSP), implement it ONLY behind a `dev` flag and keep production strict. Do not refuse the request or replace it with a different design unless asked.

---

## 🚫 FORBIDDEN PATTERNS (Will Fail ESLint & Pre-commit)

### ❌ Svelte 4 Syntax (NEVER USE - Instant Fail)

```svelte
<!-- ❌ FORBIDDEN - Will fail ESLint -->
<script>
export let title;              // Svelte 4 props → Use $props()
$: doubled = count * 2;        // Svelte 4 reactivity → Use $derived()
onMount(() => { ... });        // Svelte 4 lifecycle → Use $effect()
const dispatch = createEventDispatcher(); // Svelte 4 events → Use callbacks
</script>

<slot />                       <!-- Svelte 4 content → Use snippets -->

<!-- ✅ CORRECT - Svelte 5 Runes -->
<script lang="ts">
// Props
let { title }: { title: string } = $props();

// Reactivity
let doubled = $derived(count * 2);

// Effects
$effect(() => {
    console.log('Component mounted or count changed');
    return () => {
        console.log('Cleanup');
    };
});

// Events
let { onClick }: { onClick: () => void } = $props();

// Content
type Props = {
    children?: Snippet;
};
let { children }: Props = $props();
</script>

{@render children?.()}
```

---

### ❌ Non-Reactive State (COMMON MISTAKE - Will Break UI)

```svelte
<!-- ❌ WRONG - Won't trigger re-render -->
<script lang="ts">
let count = 0;  // Plain variable - NOT reactive
</script>

<button onclick={() => count++}>{count}</button>
<!-- Clicking increments count but UI doesn't update! -->

<!-- ✅ CORRECT - Reactive state -->
<script lang="ts">
let count = $state(0);  // Reactive - UI updates automatically
</script>

<button onclick={() => count++}>{count}</button>
<!-- UI updates when count changes! -->
```

**Rule:** If a variable appears in the template OR is passed to a child component, it MUST use `$state()`.

---

### ❌ Direct IndexedDB Access (SECURITY VIOLATION - Will Fail ESLint)

```typescript
// ❌ FORBIDDEN - No user scoping, bypasses security
const db = await getDB();
const trips = await db.getAll('trips');
// Returns ALL users' trips - SECURITY BREACH!

// ❌ FORBIDDEN - Direct objectStore access
const tx = db.transaction('trips', 'readwrite');
await tx.objectStore('trips').put(trip);
// No user validation - SECURITY BREACH!

// ✅ CORRECT - Security wrappers (user-scoped)
import { getUserTrips, saveUserTrip } from '$lib/db/queries';

const trips = await getUserTrips(userId);
// Only returns THIS user's trips ✓

await saveUserTrip(trip, userId);
// Validates ownership before saving ✓
```

**Rule:** ALWAYS use security wrappers from `$lib/db/queries.ts`. Never access IndexedDB directly.

---

### ❌ Accepting userId from Client (IDOR VULNERABILITY - Will Fail Pre-commit)

```typescript
// ❌ FORBIDDEN - Trusts client input (IDOR attack vector)
export const GET: RequestHandler = async ({ params, platform }) => {
  const key = `trip:${params.userId}:${params.tripId}`;
  //                    ^^^^^^^^^^^^^^ CLIENT CONTROLS THIS!
  const trip = await platform.env.KV.get(key);
  return json(trip);
  // Attacker can set userId=anyone and steal their data!
};

// ✅ CORRECT - Uses authenticated user
export const GET: RequestHandler = async ({ locals, params, platform }) => {
  // 1. Authenticate
  if (!locals.user) {
    throw error(401, 'Unauthorized');
  }

  // 2. Use authenticated user ID (from session)
  const key = `trip:${locals.user.id}:${params.tripId}`;
  //                    ^^^^^^^^^^^^^^^ SERVER CONTROLS THIS!

  const trip = await platform.env.KV.get(key);

  // 3. Return
  return json(trip);
};
```

**Rule:** NEVER accept `userId` from request body or params. ALWAYS use `locals.user.id`.

---

### ❌ Using process.env (CLOUDFLARE INCOMPATIBLE - Will Fail ESLint)

```typescript
// ❌ FORBIDDEN - Doesn't exist on Cloudflare edge
const apiKey = process.env.API_KEY;
// Runtime error: process is undefined

// ❌ FORBIDDEN - Unsafe fallback
const apiKey = process.env.API_KEY || 'default';
// Still fails on Cloudflare

// ✅ CORRECT - Use platform.env
import { getEnv } from '$lib/server/env';

export const GET: RequestHandler = async ({ platform }) => {
  const env = getEnv(platform);
  const apiKey = env.API_KEY; // Works on Cloudflare ✓
  // ...
};
```

**Rule:** NEVER use `process.env`. ALWAYS use `platform.env` via `getEnv()` helper.

---

### ❌ Mass Assignment (SECURITY VULNERABILITY - Will Fail ESLint)

```typescript
// ❌ FORBIDDEN - Client can inject malicious fields
export const POST: RequestHandler = async ({ request, platform }) => {
  const body = await request.json();

  // Client sends: { title: "Trip", isAdmin: true }
  await platform.env.KV.put(key, JSON.stringify(body));
  // Saved isAdmin:true - SECURITY BREACH!
};

// ❌ FORBIDDEN - Spreading body
const trip = { ...body, userId: locals.user.id };
// Client can still override userId!

// ✅ CORRECT - Explicit allowlist
export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401);

  const body = await request.json();

  // Destructure ONLY allowed fields
  const { title, date, mileage } = body as {
    title: string;
    date: string;
    mileage: number;
  };

  // Build object with explicit fields
  const trip = {
    id: crypto.randomUUID(),
    title,
    date,
    mileage,
    userId: locals.user.id, // Server-controlled
    createdAt: new Date().toISOString()
  };

  await platform.env.KV.put(key, JSON.stringify(trip));
};
```

**Rule:** NEVER spread `body` or accept all fields. ALWAYS destructure specific allowed fields.

---

### ❌ Missing await (RACE CONDITION - Will Fail ESLint)

```typescript
// ❌ WRONG - Missing await
async function saveTrip() {
  platform.env.KV.put(key, data); // Fire and forget
  redirect('/dashboard');
  // Redirect happens before save completes!
}

// ✅ CORRECT - Proper await
async function saveTrip() {
  await platform.env.KV.put(key, data); // Wait for completion
  redirect('/dashboard');
  // Redirect happens after save is confirmed ✓
}
```

**Rule:** ALWAYS await async operations. Never "fire and forget".

---

### ❌ Sync Queue Without userId (SECURITY ISSUE - Will Fail Pre-commit)

```typescript
// ❌ WRONG - No userId (can't clean up on logout)
await syncManager.addToQueue({
  action: 'create',
  tripId: trip.id,
  data: trip
  // Missing: userId
});

// ✅ CORRECT - Includes userId
await syncManager.addToQueue({
  action: 'create',
  tripId: trip.id,
  data: trip,
  userId: userId // Required for user scoping
});
```

**Rule:** ALWAYS include `userId` when adding to sync queue.

---

### ❌ Logout Without Cleanup (DATA LEAK - Will Fail Pre-commit)

```typescript
// ❌ WRONG - Doesn't clear IndexedDB
async function logout() {
  cookies.delete('session_id');
  redirect('/');
  // Previous user's data remains in IndexedDB!
}

// ✅ CORRECT - Clears all user data
import { clearUserData } from '$lib/db/queries';

async function logout() {
  const userId = locals.user.id;

  // Clear IndexedDB (REQUIRED per SECURITY.md)
  await clearUserData(userId);

  // Clear session
  cookies.delete('session_id');

  // Redirect
  redirect('/');
}
```

**Rule:** ALWAYS call `clearUserData(userId)` before logout.

---

## ⚡ Critical rules (summary)

### 1) Svelte 5 syntax (Runes only)

**Ref:** `SVELTE5_STANDARDS.md`

- **Reactive state:** Use `$state(...)` for any variable that affects rendering
- **Derived:** Use `$derived(...)` (never `$:`)
- **Props:** Use `let { ... }: Props = $props()` (never `export let`)
- **Events:** Use callback props (never `createEventDispatcher`)
- **Slots:** Use snippets + `{@render ...}` (never `<slot>`)
- **Effects:** Use `$effect(() => { ... })` (never `onMount`)

### 2) Cloudflare platform (edge runtime)

**Ref:** `ARCHITECTURE.md`

- **No Node built-ins:** never use `fs`, `path`, `process`, etc.
- **Secrets:** use `platform.env` only. Never use `process.env`.
- **Storage ownership:** enforce user-scoped composite keys (e.g., `trip:${locals.user.id}:${id}`).
- **I/O correctness:** always `await` storage/network I/O. Never "fire and forget".

### 3) Strict TypeScript

- **No `any`.** Use `unknown` + safe narrowing.
- **No `// @ts-ignore`.** Use `// @ts-expect-error` only when unavoidable, with justification.
- **No implicit `never[]`.** Always type empty arrays explicitly.
- **Prefer `import type`** for types.

### 4) Design & styling

**Ref:** `DESIGN_SYSTEM.md`

- Use only Tailwind utilities allowed by the repo config.
- Forbidden: arbitrary values (e.g. `bg-[#ff0000]`), raw CSS, `<style>` blocks.

---

## 🛡️ Security protocol (non-negotiable)

**Ref:** `SECURITY.md`

- **Input:** never trust `request.json()` wholesale. Validate + allowlist every field.
- **Auth:** never accept `userId` / owner identifiers from the request body. Ownership comes from `locals.user`.
- **Output & caching:** user data responses must be `no-store` (and must not be cached by the SW).
- **Browser storage:** never store secrets/PII in `localStorage` or `sessionStorage`.
- **IndexedDB:** ALWAYS use security wrappers from `$lib/db/queries.ts`. Never access directly.
- **Logout:** ALWAYS call `clearUserData(userId)` to prevent cross-user contamination.

---

## Response guidelines

- **Show code first.** Explanation second.
- Use only **edge-compatible** libraries (no Node-only deps).
- Before backend code, check `src/app.d.ts` for available `platform.env` bindings.
- Prefer canonical SvelteKit patterns:
  - For errors: `throw error(status, message)`
  - For JSON: `return json(data, { status })` (set status explicitly for non-200)
  - For redirects: `throw redirect(status, path)` or `redirect(status, path)`

---

## 💡 Quick Reference

**When creating a Svelte component:**

1. Always use `lang="ts"`
2. Use `$state()` for reactive variables
3. Use `$derived()` for computed values
4. Use `$effect()` for side effects
5. Use `$props()` for component props

**When creating an API route:**

1. Authenticate with `locals.user`
2. Validate input (destructure specific fields)
3. Use `platform.env` via `getEnv()`
4. Build user-scoped keys
5. Always `await` operations
6. Return proper Response

**When using IndexedDB:**

1. Import from `$lib/db/queries.ts`
2. Use `getUserTrips(userId)`
3. Use `saveUserTrip(trip, userId)`
4. Use `deleteUserTrip(id, userId)`
5. Never access `db` directly

**When logging out:**

1. Call `clearUserData(userId)`
2. Delete session cookie
3. Redirect to login
