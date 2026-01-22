# SVELTE5_STANDARDS.md

**Status:** Post-migration standards (Svelte 5 runes mode)  
**Applies to:** All new and modified Svelte code once migration is complete  
**Goal:** Keep the codebase 100% Svelte 5 runes-mode, strongly typed, and CI-safe.

---

## Non‑Negotiables (RUNE‑ONLY)

### ✅ Props

- Use `$props()` only.
- **Never** use `export let` in runes mode.

✅

```svelte
<script lang="ts">
	type Props = { title: string; subtitle?: string };
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

### ✅ State

- Use `$state` for reactive state.
- Prefer specific types or inference.

✅

```svelte
<script lang="ts">
	type Item = { id: string; name: string };
	let items = $state<Item[]>([]);
	let selectedId = $state<string | null>(null);
</script>
```

---

### ✅ Derived values (computed)

- Use `$derived` for computed values.
- **Never** use `$:` reactive statements.

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

### ✅ Effects (side effects)

- Use `$effect` for side effects (subscriptions, DOM effects, fetches tied to state).
- Keep effects small and deterministic.

✅

```svelte
<script lang="ts">
	let ready = $state(false);

	$effect(() => {
		if (!ready) return;
		// side effect here (e.g., start polling, subscribe, etc.)
	});
</script>
```

---

## Event Handling (Svelte 5)

### Use event attributes (not `on:` directives)

- Prefer native DOM event attributes like: `onclick`, `oninput`, `onchange`, etc.
- Use camelCase where required by the underlying event attribute name.

✅

```svelte
<button onclick={save}>Save</button>
<input oninput={handleInput} />
```

### Custom events

- For custom elements / custom events, bind using the correct Svelte event attribute form.
- **Do not** use `onplace-selected` or similar “raw attribute” forms.

✅

```svelte
<MyElement onplaceselected={handlePlaceSelected} />
```

> If the emitted event name contains dashes (e.g. `place-selected`), ensure the binding matches how the component emits it in Svelte 5. If TypeScript complains, add explicit typing to the handler:

```svelte
<script lang="ts">
	function handlePlaceSelected(e: CustomEvent<{ placeId: string }>) {
		// ...
	}
</script>
```

---

## TypeScript Standards (STRICT)

### TypeScript typing for Svelte 5 runes (STRICT)

- `$state`, `$derived`, and `$props` are the reactive primitives; TypeScript types may be applied to them.
- Prefer **explicit, specific types** (or rely on inference) instead of `any`.
- ❌ Avoid: `let data = $state<any>(null);`
- ✅ Prefer: `let data = $state<MyType | null>(null);` or initialize with a typed value so TS infers.
- If the shape is unknown (e.g., untrusted JSON), use `unknown` and narrow/validate before use.
- `any` is allowed ONLY as a temporary bridge for a 3rd-party library or legacy boundary, and MUST be narrowed to a real type as soon as possible with a comment explaining why.

### TypeScript typing for Svelte 5 runes (STRICT)

- `$state`, `$derived`, and `$props` are the reactive primitives; TypeScript types may be applied to them.
- Prefer **explicit, specific types** (or rely on inference) instead of `any`.
- ❌ Avoid: `let data = $state<any>(null);`
- ✅ Prefer: `let data = $state<MyType | null>(null);` or initialize with a typed value so TS infers.
- If the shape is unknown (e.g., untrusted JSON), use `unknown` and narrow/validate before use.
- `any` is allowed ONLY as a temporary bridge for a 3rd-party library or legacy boundary, and MUST be narrowed to a real type as soon as possible with a comment explaining why.

### Common TS pitfall: function vs value

**Error:** `Type '() => string' is not assignable to type 'string'.`

Cause: You passed a function where a string value is expected.

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

---

## DOM + Markup Rules (Quick)

- Prefer semantic HTML.
- Avoid invalid nesting and interactive element nesting (button-in-button, link-in-link).
- Keep ARIA accurate and minimal; do not add ARIA unless needed.
- Follow `HTML_LIVING_STANDARD.md` when in doubt.

---

## Lint / Check Requirements (Definition of Done)

Before committing changes that touch Svelte/TS:

- `npm run check`
- `npm run lint`
- `npx eslint .`

If CI enforces additional commands, match CI.

---

## Hard “No Regression” Checks (Recommended)

Run these after migration completion to prevent legacy syntax reappearing.

### Reject legacy `export let`

```bash
git grep -n "export\s+let\s" -- "*.svelte"
```

### Reject legacy `$:` reactive labels

```bash
git grep -n "^\s*\$:" -- "*.svelte"
```

> If either grep returns matches, the PR is not acceptable in post‑migration mode.

---

## Post‑Migration Mode (Enforcement)

When the repository is declared **migration complete**:

- **All** new and modified files MUST comply with this document.
- Legacy/migration-only patterns are not permitted anywhere in the repo.
- If a change would require reintroducing legacy syntax, the change must be redesigned.

---

## Canonical Error Fixes (Quick Reference)

- **Cannot use `export let` in runes mode** → Replace with `$props()`.
- **`$:` not allowed in runes mode** → Replace with `$derived` / `$effect`.
- **`() => string` not assignable to `string`** → Call it, or change the prop type, or compute via `$derived`.
- **“Object literal may only specify known properties … onplace-selected …”** → Fix event binding to Svelte 5 event attribute form and/or type the event handler.
