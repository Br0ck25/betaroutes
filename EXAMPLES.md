# Canonical Svelte 5 Examples

This document defines **approved, CI-safe Svelte 5 patterns** for this repository.

All examples:
- Use **Svelte 5 runes-based reactivity**
- Avoid all legacy Svelte 4 APIs
- Follow the **HTML Living Standard**
- Are compatible with **PWA constraints**
- Are safe for AI and CI enforcement

---

## State (`$state`)

Use `$state` for local, mutable component state.

```svelte
<script>
	let count = $state(0);
</script>

<button onclick={() => count++}>
	{count}
</button>
```

---

## Derived State (`$derived`)

Use `$derived` for values computed from other state.

```svelte
<script>
	let count = $state(2);
	let doubled = $derived(count * 2);
</script>

<p>Doubled: {doubled}</p>
```

Rules for `$derived`:
- Must be pure
- Must be synchronous
- No side effects

---

## Effects (`$effect`)

Use `$effect` for side effects and lifecycle-like behavior.

```svelte
<script>
	let count = $state(0);

	$effect(() => {
		console.log('Count changed:', count);
	});
</script>
```

### Cleanup

```svelte
<script>
	let active = $state(true);

	$effect(() => {
		const id = setInterval(() => {
			if (active) {
				console.log('tick');
			}
		}, 1000);

		return () => clearInterval(id);
	});
</script>
```

---

## Component Props (`$props`)

Props must be read using `$props()`.

```svelte
<script>
	let { label, disabled = false } = $props();
</script>

<button {disabled}>
	{label}
</button>
```

❌ Do not use `export let` in migrated files.

---

## Event Handling

Use **standard DOM attributes**, not Svelte directives.

```svelte
<button onclick={() => alert('clicked')}>
	Click me
</button>
```

❌ `on:click` is forbidden in Svelte 5 files.

---

## Snippets (Slots Replacement)

Slots are replaced with **snippets** and `{@render}`.

```svelte
<script>
	let { children } = $props();
</script>

<section>
	{@render children()}
</section>
```

---

## HTML Living Standard

Correct:

```html
<input disabled>
```

Incorrect:

```html
<input disabled="true" />
```

---

## Forbidden Patterns (Examples)

```svelte
<script>
	export let value;
	$: doubled = value * 2;
	onMount(() => {});
</script>
```

```svelte
<script>
	import { writable } from 'svelte/store';
</script>
```

---

## Migration Note

This file documents the **final Svelte 5 state**.

Legacy syntax may exist **only** in files explicitly marked:

```html
<!-- MIGRATION: SVELTE4-LEGACY -->
```

Once migrated, legacy allowances are permanently revoked.
