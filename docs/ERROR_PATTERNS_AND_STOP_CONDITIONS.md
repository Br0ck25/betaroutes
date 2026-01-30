# AI Guardrails & Error Patterns

This file is **supplemental**.

✅ **Canonical agent instructions live in `AGENTS.md`.**  
This document exists to capture **recurring error patterns** and **stop conditions** so AI tools (and humans) avoid costly mistakes.

**Precedence:** If rules conflict, follow this hierarchy:

1. `SECURITY.md`
2. `ARCHITECTURE.md`
3. `PWA.md`
4. `HTML_LIVING_STANDARD.md`
5. `DESIGN_SYSTEM.md`
6. `SVELTE5_STANDARDS.md`
7. This file (`AI_AGENTS.md`) — _supplemental only_

---

## Mandatory reading (before any change)

You MUST read and follow:

- `AGENTS.md` (canonical router + forbidden patterns)
- `REPOSITORY_GOVERNANCE.md` (repo-wide enforcement + zero tolerance)
- `SECURITY.md` (zero trust + data isolation)
- `ARCHITECTURE.md` (storage/key boundaries + data flow)
- `SVELTE5_STANDARDS.md` (Runes-only Svelte 5)
- `PWA.md` (offline-first + service worker policy)
- `HTML_LIVING_STANDARD.md` (strict HTML parsing rules)
- `DESIGN_SYSTEM.md` (strict Tailwind + palette rules)

> Only read `SVELTE5_MIGRATION.md` if you are explicitly migrating legacy files.

---

## 🛑 Stop conditions (mandatory)

**STOP and ask the maintainer** before proceeding if:

1. **Security impact**
   - auth/session changes
   - password/reset flows
   - any endpoint that returns user data
   - any changes to key patterns or scoping

2. **PWA impact**
   - service worker changes
   - manifest changes
   - caching strategy changes
   - offline queue/sync behavior changes

3. **Architecture impact**
   - multiple viable approaches exist
   - breaking changes to public APIs/types
   - moving data across KV/D1/DO boundaries

4. **Governance conflicts / uncertainty**
   - you’re unsure about any rule or precedence
   - a change would require an eslint/ts “exception”

---

## Non-negotiables (quick reminders)

- **Svelte 5 only (Runes).** Introducing Svelte 4 syntax (`export let`, `$:`, `<slot>`, `createEventDispatcher`) is an instant fail.
- **No Node.js APIs.** Edge runtime only (`platform.env` for bindings).
- **Zero trust client.** Ownership comes from `locals.user.id` only.
- **No caching `/api/**` in the service worker.\*\* Use IndexedDB for offline data instead.
- **No `any`.** No `// @ts-ignore`.

---

## ⚠️ Critical error patterns to avoid

### Error Pattern #1: Missing `lang="ts"`

**Symptom:** parse errors like `'<` cannot be applied to types`, `'string' only refers to a type` 
**Cause:** using TS syntax without`lang="ts"`

✅ Correct:

```svelte
<script lang="ts">
  type Item = { id: string };
  let items = $state<Item[]>([]);
</script>
```

---

### Error Pattern #2: Reintroducing banned legacy syntax

**Symptom:** build fails / runes-mode mismatch  
**Cause:** adding Svelte 4 patterns or mixing paradigms

❌ Wrong:

```svelte
<script lang="ts">
  export let title: string;
  $: doubled = count * 2;
</script>
```

✅ Correct: use `$props()` + `$derived()` + `$effect()` per `SVELTE5_STANDARDS.md`.

Also forbidden in runes mode:

- `$$props`
- `$$restProps`

Use `$props()` destructuring instead.

---

### Error Pattern #3: Server routes missing returns

**Symptom:** `Not all code paths return a value`, `Type 'undefined' is not assignable to type 'Response'`  
**Cause:** handler forgets to `return`

✅ Correct:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized');
  return json({ ok: true });
};
```

---

### Error Pattern #4: Passing possibly-undefined values

**Symptom:** `Object is possibly 'undefined'`  
**Cause:** using optional values without guards

✅ Correct:

```ts
const item = items[index];
if (!item) return;
```

---

### Error Pattern #5: Unreachable code after `return`

**Symptom:** `Unreachable code detected`  
**Cause:** logic placed after a `return`

✅ Correct: move code before return or restructure control flow.

---

### Error Pattern #6: Zombie variables / unused args

**Symptom:** `'x' is declared but its value is never read`  
**Cause:** speculative state, unused imports/args

✅ Correct: delete it. Do not keep “just in case”.

---

### Error Pattern #7: Type/signature hallucinations

**Symptom:** `Expected X arguments, but got Y` or missing fields on types  
**Cause:** guessing signatures or type shapes

✅ Correct: read the real definition (or `src/app.d.ts`) first.

---

## 🛡️ Security error patterns (audit class)

### Error Pattern #10: Insecure ID fallbacks (ATO / IDOR risk)

❌ Wrong:

```ts
return user?.id || user?.name || user?.email || '';
```

✅ Correct:

```ts
if (!user?.id) throw new Error('User ID missing');
return user.id;
```

---

### Error Pattern #11: Mass assignment (data injection)

❌ Wrong:

```ts
const body = await request.json();
await KV.put(key, JSON.stringify(body));
```

✅ Correct (allowlist + validate):

```ts
const body = await request.json();
const { date, mileage } = body as { date: string; mileage: number };
await KV.put(key, JSON.stringify({ date, mileage, userId: locals.user.id }));
```

---

### Error Pattern #12: Global data leaks

❌ Wrong:

```ts
await KV.put('recent_places', JSON.stringify(places));
```

✅ Correct:

```ts
await KV.put(`places:${locals.user.id}`, JSON.stringify(places));
```

---

### Error Pattern #13: Hardcoded secrets

Never commit secrets or embed them in code. Use `platform.env`.

---

### Error Pattern #14: Debug/backdoor endpoints

Do not create `/api/debug/*` routes, destructive “wipe” endpoints, or auth bypass helpers.

---

## ☁️ Cloudflare type & KV pitfalls

### Error Pattern #18: Type conflicts from importing Workers types

❌ Wrong:

```ts
import { KVNamespace } from '@cloudflare/workers-types';
```

✅ Correct: use the global ambient types (and your `app.d.ts` bindings).

### Error Pattern #30: The KV cursor union trap

`kv.list()` is a union. Guard cursor access:

```ts
const list = await kv.list({ prefix, cursor });
const nextCursor = list.list_complete ? undefined : list.cursor;
```

---

## Client fetch + CSRF

If the app uses CSRF tokens for mutation endpoints, all manual `fetch()` calls MUST send the token header (per `SECURITY.md`).

---

## ✅ Success criteria

Before declaring work “done”:

```bash
npm run gate
```

If this fails, do not “patch around” errors. Fix the root cause or stop and ask.
