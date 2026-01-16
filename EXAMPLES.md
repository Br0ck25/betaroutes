# Canonical Svelte 5 Examples

This file documents **approved Svelte 5 patterns** for this repository.

All examples:

- Use **runes-based reactivity**
- Avoid legacy Svelte 4 APIs
- Follow the **HTML Living Standard**
- Are safe for CI enforcement

---

## State

Use `$state` for local, mutable state.

```svelte
<script>
	let count = $state(0);
</script>

<button onclick={() => (count += 1)}>
	{count}
</button>
```

---

## Derived State

Use `$derived` for values computed from other state.

```svelte
<script>
	let count = $state(2);
	let doubled = $derived(count * 2);
</script>

<p>Doubled: {doubled}</p>
```

Derived values must be:

- Pure
- Side-effect free
- Synchronous

---

## Effects

Use `$effect` for side effects and lifecycle-like behavior.

```svelte
<script>
	let count = $state(0);

	$effect(() => {
		console.log('Count changed:', count);
	});
</script>
```

Cleanup example:

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

## Component Props

```svelte
<script>
	let { value, disabled = false } = $props();
</script>

<button {disabled}>
	{value}
</button>
```

---

## Event Handling

```svelte
<button onclick={() => alert('clicked')}> Click me </button>
```

---

## Snippets

```svelte
<script>
	let { children } = $props();
</script>

<section>
	{@render children()}
</section>
```

---

## HTML Rules

Correct:

```html
<input disabled />
```

Incorrect:

```html
<input disabled="true" />
```

---

## Forbidden Patterns

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

## Migration Notes

This file documents the **final Svelte 5 state**.
