# SVELTE5_STANDARDS.md

**Single source of truth** for Svelte 5 + TypeScript standards in this repo.

- **Mode:** Svelte 5 **runes mode**
- **Applies to:** all new code and all modified files
- **Non-goal:** migration guidance (see `SVELTE5_MIGRATION.md` only when doing legacy conversions)

---

## Non‑negotiables (RUNES ONLY)

### Props

- ✅ Use `$props()` only.
- ❌ Never use `export let` in runes mode.

✅

```svelte
<script lang="ts">
	type Props = {
		title: string;
		subtitle?: string;
	};

	let { title, subtitle }: Props = $props();
</script>
```

❌

```svelte
<script>
	export let title;
</script>
```

---

### State

- ✅ Use `$state(...)` for reactive state.

✅

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
- ❌ Never use `$:` reactive statements.

✅

```svelte
<script lang="ts">
	let a = $state(0);
	let b = $state(0);

	let total = $derived(a + b);
</script>
```

❌

```svelte
<script>
	$: total = a + b;
</script>
```

---

### Effects (side effects)

- ✅ Use `$effect(() => { ... })` for side effects.
- Keep effects small and deterministic.

✅

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
- ❌ Do not use `<slot />` in new code.

✅

```svelte
<script lang="ts">
	let { children } = $props<{ children?: () => any }>();
</script>

{@render children?.()}
```

For named regions, use snippet props:

✅

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
- ❌ Do not use `on:click`, `on:input`, etc.

✅

```svelte
<button onclick={save}>Save</button>
<input oninput={handleInput} />
```

---

### Custom DOM events (web components / custom elements)

**Preferred standard**

- ✅ Use the event property form (remove the colon):
  - `onplace-selected={handler}` for a `place-selected` event

✅

```svelte
<MyElement onplace-selected={handlePlaceSelected} />
```

Type the handler as needed:

✅

```svelte
<script lang="ts">
	function handlePlaceSelected(e: CustomEvent<{ placeId: string }>) {
		// ...
	}
</script>
```

**Allowed temporary exception (only when unavoidable)**

- If TypeScript cannot be satisfied promptly (missing/3rd‑party typings), you may use `on:place-selected={...}` **only as a temporary bridge** and must add a `TODO` to replace it with proper typings + event property form.
- This exception is **only** for custom DOM events (not for standard DOM events).

---

### Component “events” (Svelte components)

- ✅ Prefer **callback props**.
- ❌ Do not introduce `createEventDispatcher` in new code.

✅ Parent

```svelte
<script lang="ts">
	import Child from './Child.svelte';

	function onSave(id: string) {
		// ...
	}
</script>

<Child {onSave} />
```

✅ Child

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

✅

```ts
let raw: unknown;

function isApiResponse(x: unknown): x is { ok: boolean } {
	return typeof x === 'object' && x !== null && 'ok' in x;
}
```

---

## Common TypeScript pitfalls (Fix patterns)

### Function vs value

**Error:** `Type '() => string' is not assignable to type 'string'.`

Cause: you passed a function where a string value is expected.

Fix options:

- Call it: `label={getLabel()}`
- Or change the receiving type: `string | (() => string)`
- Or compute via `$derived` if it depends on state.

✅

```svelte
<script lang="ts">
	function getLabel() {
		return 'Hello';
	}

	let label = $derived(getLabel());
</script>

<MyComponent {label} />
```

### Unknown prop / wrong attribute name

**Error:** `Object literal may only specify known properties ... 'onplace-selected' does not exist in type ...`

Fix checklist:

1. Confirm you’re binding the **right thing** (prop vs event).
2. For custom DOM events: use `onplace-selected={...}` and type the handler.
3. If TS still complains, add typings for the custom element/event (preferred), or use the temporary `on:place-selected` exception with a TODO.

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

✅

```ts
const results = await Promise.all(items.map(async (item) => compute(item)));
```

✅

```ts
for (const item of items) {
	await compute(item);
}
```

---

## Definition of Done (Required)

Before committing changes that touch Svelte/TS:

- `npm run check`
- `npm run lint`
- `npx eslint .`

---

## No‑regression checks (Recommended)

Reject legacy syntax after migration:

### Reject `export let`

```bash
git grep -n "export\s+let\s" -- "*.svelte"
```

### Reject `$:` reactive labels

```bash
git grep -n "^\s*\$:" -- "*.svelte"
```

### Reject `<slot`

```bash
git grep -n "<slot" -- "*.svelte"
```

---

## Canonical error fixes (Quick reference)

- **Cannot use `export let` in runes mode** → Replace with `$props()`.
- **`$:` not allowed in runes mode** → Replace with `$derived` / `$effect`.
- **`() => string` not assignable to `string`** → Call it, widen the type, or compute via `$derived`.
- **Unknown `on...` property / event typing** → Use correct event property form + add typings; only use `on:` as a temporary custom-event exception with a TODO.
