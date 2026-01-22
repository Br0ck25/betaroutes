# SVELTE5_STANDARDS.md

**Single source of truth** for Svelte 5 + TypeScript standards in this repo.

- **Mode:** Svelte 5 **runes mode**
- **Applies to:** All **NEW** files and files **being migrated**
- **Scope:** Standards reference (not migration instructions - see `SVELTE5_MIGRATION.md` for that)

---

## 🎯 When to Use This Document

**Use this document when:**

- ✅ Creating a **new** .svelte file (always use Svelte 5)
- ✅ Creating a **new** component (always use Svelte 5)
- ✅ Migrating an existing file (refer to patterns here)
- ✅ Checking syntax for Svelte 5 features
- ✅ Resolving TypeScript errors in Svelte 5 files

**Do NOT use this document for:**

- ❌ Editing existing Svelte 4 files (keep them in Svelte 4)
- ❌ Migration decision-making (see `SVELTE5_MIGRATION.md`)
- ❌ Determining IF something should be migrated

---

## ⚠️ CRITICAL: TypeScript + Svelte 5 Requirements

### Always Add `lang="ts"` When Using TypeScript

If you use ANY TypeScript syntax, you MUST add `lang="ts"` to the `<script>` tag:

❌ **WRONG - Creates 50+ parse errors:**

```svelte
<script>
	let items = $state<Item[]>([]); // TypeScript syntax without lang="ts"
	function doThing(id: string) {} // Type annotations won't work
</script>
```

✅ **CORRECT:**

```svelte
<script lang="ts">
	let items = $state<Item[]>([]);
	function doThing(id: string) {}
</script>
```

**TypeScript syntax includes:**

- Type parameters: `<Type>`, `<T>`
- Type annotations: `: Type`, `: string`
- Type keywords: `interface`, `type`, `enum`
- Generic constraints: `<T extends Base>`

**Rule: If you add any TypeScript syntax, add `lang="ts"` to the `<script>` tag.**

---

## Non‑negotiables (RUNES ONLY)

### Props

- ✅ Use `$props()` only.
- ❌ Never use `export let` in Svelte 5.

✅ **Correct Pattern:**

```svelte
<script lang="ts">
	type Props = {
		title: string;
		subtitle?: string;
	};

	let { title, subtitle }: Props = $props();
</script>
```

---

### State

- ✅ Use `$state(...)` for reactive state.
- ✅ Add type parameters when appropriate.

✅ **Correct Pattern:**

```svelte
<script lang="ts">
	type Item = { id: string; name: string };

	let items = $state<Item[]>([]);
	let selectedId = $state<string | null>(null);
</script>
```

---

### Derived values (computed)

- ✅ Use `$derived(...)` for computed values.
- ❌ Do not use `$:` reactive statements in Svelte 5.

✅ **Correct Pattern:**

```svelte
<script lang="ts">
	let a = $state(0);
	let b = $state(0);

	let total = $derived(a + b);
</script>
```

---

### Effects (side effects)

- ✅ Use `$effect(() => { ... })` for side effects.
- Keep effects small and deterministic.

✅ **Correct Pattern:**

```svelte
<script lang="ts">
	let ready = $state(false);

	$effect(() => {
		if (!ready) return;

		// side effect here (subscribe, fetch, write to storage, etc.)
		// return a cleanup function if needed
		return () => {
			// cleanup
		};
	});
</script>
```

---

## Rendering (Snippets only)

- ✅ Use snippet props + `{@render ...}`.
- ❌ Do not use `<slot />` in Svelte 5.

✅ **Default slot pattern:**

```svelte
<script lang="ts">
	let { children } = $props<{ children?: () => any }>();
</script>

{@render children?.()}
```

✅ **Named slots pattern:**

```svelte
<script lang="ts">
	let { header, footer } = $props<{
		header?: () => any;
		footer?: () => any;
	}>();
</script>

<header>{@render header?.()}</header><footer>{@render footer?.()}</footer>
```

---

## Event Handling (Svelte 5)

### DOM events (preferred)

- ✅ Use DOM event properties: `onclick`, `oninput`, `onchange`, etc.
- ❌ Do not use `on:click`, `on:input`, etc. in Svelte 5.

✅ **Correct Pattern:**

```svelte
<button onclick={save}>Save</button>
<input oninput={handleInput} />
```

---

### Custom DOM events (web components / custom elements)

**Preferred standard:**

- ✅ Use the event property form (remove the colon):
  - `onplace-selected={handler}` for a `place-selected` event

✅ **Correct Pattern:**

```svelte
<MyElement onplace-selected={handlePlaceSelected} />
```

**Type the handler:**

```svelte
<script lang="ts">
	function handlePlaceSelected(e: CustomEvent<{ placeId: string }>) {
		// ...
	}
</script>
```

**Allowed temporary exception (only when unavoidable):**

- If TypeScript cannot be satisfied promptly (missing/3rd‑party typings), you may use `on:place-selected={...}` **only as a temporary bridge** and must add a `TODO` to replace it with proper typings + event property form.
- This exception is **only** for custom DOM events (not for standard DOM events).

---

### Component "events" (Svelte components)

- ✅ Prefer **callback props**.
- ❌ Do not introduce `createEventDispatcher` in Svelte 5.

✅ **Parent:**

```svelte
<script lang="ts">
	import Child from './Child.svelte';

	function onSave(id: string) {
		// ...
	}
</script>

<Child {onSave} />
```

✅ **Child:**

```svelte
<script lang="ts">
	let { onSave } = $props<{ onSave?: (id: string) => void }>();
</script>

<button onclick={() => onSave?.('123')}>Save</button>
```

---

## TypeScript typing for Svelte 5 runes (STRICT)

- `$state`, `$derived`, and `$props` are the reactive primitives; TypeScript types may be applied to them.
- Prefer **explicit, specific types** (or rely on inference) instead of `any`.
- ❌ Avoid: `let data = $state<any>(null);`
- ✅ Prefer: `let data = $state<MyType | null>(null);` or initialize with a typed value so TS infers.
- If the shape is unknown (e.g., untrusted JSON), use `unknown` and narrow/validate before use.
- `any` is allowed ONLY as a temporary bridge for a 3rd-party library or legacy boundary, and MUST be narrowed to a real type as soon as possible with a comment explaining why.

### `unknown` for untrusted data

✅ **Correct Pattern:**

```ts
let raw: unknown;

function isApiResponse(x: unknown): x is { ok: boolean } {
	return typeof x === 'object' && x !== null && 'ok' in x;
}
```

---

## Common TypeScript pitfalls (Fix patterns)

### SvelteKit server routes (+server.ts) requirements

#### RequestHandler must always return a Response

In `src/routes/**/+server.ts` handlers (`GET`, `POST`, etc.):

- **All code paths MUST return a `Response`.** Never return `undefined`.
- Use early returns for errors/auth failures:
  - `return new Response(JSON.stringify({ error: '...' }), { status: 401 })`
- Avoid bare `return;` inside a handler.

✅ **Correct Pattern:**

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
	// Early return for auth
	if (!locals.user) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
	}

	// Early return for validation
	const body = await request.json();
	if (!body || !body.requiredField) {
		return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
	}

	// Main logic
	const result = await doSomething(body);

	// Final return (REQUIRED)
	return new Response(JSON.stringify({ success: true, data: result }));
};
```

**This prevents:**

- `Promise<Response | undefined> is not assignable to RequestHandler`
- `Not all code paths return a value`

---

#### Guard optional / possibly‑undefined values before calling helpers

If TypeScript says a value is `T | undefined`:

- **Do not** pass it into helpers expecting `T`.
- Fix with:
  - Early guard: `if (!value) return new Response(..., { status: 400 })`
  - Type guard + filtering when building arrays: `arr.filter(isDefined)`
  - Safe indexing checks before using `arr[i]`

✅ **Correct Pattern:**

```typescript
const items = [a, b, c];
const index = items.indexOf(target);

// Guard before using
if (index === -1) {
	return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

const item = items[index]!; // Safe after guard
doSomething(item);
```

**Avoid `as T` casts that merely silence TypeScript.**

---

### Function vs value

**Error:** `Type '() => string' is not assignable to type 'string'.`

**Cause:** you passed a function where a string value is expected.

**Fix options:**

- Call it: `label={getLabel()}`
- Or change the receiving type: `string | (() => string)`
- Or compute via `$derived` if it depends on state.

✅ **Correct Pattern:**

```svelte
<script lang="ts">
	function getLabel() {
		return 'Hello';
	}

	let label = $derived(getLabel());
</script>

<MyComponent {label} />
```

---

### Unknown prop / wrong attribute name

**Error:** `Object literal may only specify known properties ... 'onplace-selected' does not exist in type ...`

**Fix checklist:**

1. Confirm you're binding the **right thing** (prop vs event).
2. For custom DOM events: use `onplace-selected={...}` and type the handler.
3. If TS still complains, add typings for the custom element/event (preferred), or use the temporary `on:place-selected` exception with a TODO.

---

### Unreachable code after return

**Error:** `Unreachable code detected`

**Cause:** Code placed after a `return` statement.

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

// Code is reachable here
assignments[idx].stops.push(stop);
```

---

## Markup & HTML rules (Quick)

- Prefer semantic HTML.
- Avoid invalid nesting (e.g., button inside button, link inside link).
- Keep ARIA accurate and minimal; do not add ARIA unless needed.
- Follow `HTML_LIVING_STANDARD.md` when in doubt.

---

## Promise / async safety (TypeScript)

- Do not use `await` inside `Array.prototype.map`. Use `Promise.all`.
- Do not mix `await` with `forEach`. Use `for...of` or `Promise.all`.

✅ **Correct Patterns:**

```ts
const results = await Promise.all(items.map(async (item) => compute(item)));
```

```ts
for (const item of items) {
	await compute(item);
}
```

---

## File Template: New Svelte 5 Component

Use this as a starting template for all new .svelte files:

```svelte
<script lang="ts">
	// Type definitions
	type Props = {
		// Define your props here
	};

	// Props
	let {} /* destructure props */ : Props = $props();

	// State
	let someState = $state<Type>(initialValue);

	// Derived values
	let computed = $derived(someState * 2);

	// Effects (if needed)
	$effect(() => {
		// Side effects here
		return () => {
			// Cleanup
		};
	});

	// Event handlers
	function handleClick() {
		// Handler logic
	}
</script>

<!-- Markup -->
<div>
	<button onclick={handleClick}>Click me</button>
</div>

<style>
	/* Component styles */
</style>
```

---

## Definition of Done (Required)

Before committing changes that touch Svelte/TS:

```bash
npm run check   # Must pass with 0 errors
npm run lint    # Must pass
npx eslint .    # Must pass
```

**If you see TypeScript errors:**

1. Review your changes
2. Check for missing `lang="ts"`
3. Check for missing `return` statements
4. Check for unguarded optional values
5. Do NOT create more changes to "fix" errors - fix the root cause

---

## Quick Reference

| Svelte 4 Syntax   | Svelte 5 Equivalent           |
| ----------------- | ----------------------------- |
| `export let x`    | `let { x } = $props()`        |
| `let x = value`   | `let x = $state(value)`       |
| `$: y = x * 2`    | `let y = $derived(x * 2)`     |
| `$: { doSide() }` | `$effect(() => { doSide() })` |
| `<slot />`        | `{@render children?.()}`      |
| `on:click`        | `onclick`                     |
| `on:input`        | `oninput`                     |

---

## Canonical error fixes (Quick reference)

- **Parse errors with TypeScript syntax** → Add `lang="ts"` to `<script>` tag
- **Not all code paths return a value** → Add return statements on all branches in RequestHandler
- **Object is possibly undefined** → Add guards before array indexing or optional chaining
- **Unreachable code detected** → Remove code after return statements
- **`() => string` not assignable to `string`** → Call it, widen the type, or compute via `$derived`
- **Unknown `on...` property / event typing** → Use correct event property form + add typings
