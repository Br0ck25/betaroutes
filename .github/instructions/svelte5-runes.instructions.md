---
description: 'Svelte 5 Runes strict enforcement'
applyTo: '**/*.svelte'
---

# Svelte 5 (Runes) Strict Rules

## Forbidden (Zero Tolerance)

- `export let` (use `$props()`)
- `$:` reactive statements (use `$derived` / `$effect`)
- `createEventDispatcher` (use callback props)
- `$$props`, `$$restProps` (use `$props()` destructuring)
- `beforeUpdate`, `afterUpdate` (use `$effect.pre` / `$effect`)
- `onMount`, `onDestroy` (use `$effect` with cleanup)
- `<slot>` (use snippets: `{#snippet}` / `{@render}`)

## Required style

- Keep components small and explicit (< 300 lines).
- Prefer pure functions + typed helpers.
- No `any`. Use `unknown` and narrow with type guards.
- No lint/ts disables (`// @ts-ignore`, `// eslint-disable`).
- Always use `lang="ts"` if any TypeScript syntax is present.

## Props pattern

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    count?: number;
    children?: Snippet;
  };

  let { title, count = 0, children }: Props = $props();
</script>
```

## State pattern

```svelte
<script lang="ts">
  // Local mutable state
  let count = $state(0);

  // Typed arrays
  let items = $state<string[]>([]);

  // Objects
  let user = $state<User | null>(null);
</script>
```

## Derived pattern

```svelte
<script lang="ts">
  let count = $state(0);

  // Simple derived
  let doubled = $derived(count * 2);

  // Complex derived
  let isValid = $derived.by(() => {
    return count > 0 && count < 100;
  });
</script>
```

## Effects pattern

```svelte
<script lang="ts">
  let count = $state(0);

  // Side effect with cleanup
  $effect(() => {
    console.log('Count changed:', count);

    const timer = setInterval(() => {
      console.log('Current count:', count);
    }, 1000);

    return () => clearInterval(timer);
  });
</script>
```

## Event handlers

```svelte
<script lang="ts">
  function handleClick() {
    console.log('Clicked!');
  }

  // Callback prop for parent communication
  type Props = {
    onSave: (id: string) => void;
  };

  let { onSave }: Props = $props();
</script>

<!-- DOM events: use onclick -->
<button onclick={handleClick}>Click me</button>

<!-- Parent callback: call directly -->
<button onclick={() => onSave('123')}>Save</button>
```

## Snippets pattern

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    header?: Snippet;
    children?: Snippet;
  };

  let { header, children }: Props = $props();
</script>

<div>
  {#if header}
    {@render header()}
  {/if}

  <main>
    {#if children}
      {@render children()}
    {/if}
  </main>
</div>
```

## Interaction safety

- Never render untrusted HTML without sanitization
- Avoid leaking sensitive data to the client
- Validate all user input before processing
- Use security wrappers for data access
