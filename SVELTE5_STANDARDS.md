# Svelte 5 Standards (Runes + TypeScript)

**Single source of truth** for Svelte 5 + TypeScript standards in this repo.

- **Mode:** Svelte 5 **Runes Mode** (Strict)
- **Applies to:** ALL `.svelte` and TypeScript files
- **Scope:** Implementation patterns and â€œhow we write codeâ€

---

## TypeScript requirements (critical)

### Always use `lang="ts"`

If you use **any** TypeScript syntax, you MUST use `lang="ts"`.

âœ… Correct:

```svelte
<script lang="ts">
  type Item = { id: string };
  let items = $state<Item[]>([]);
</script>
```

### No `any` / no `@ts-ignore`

- âŒ `any` is forbidden (use `unknown` + narrowing).
- âŒ `// @ts-ignore` is forbidden (use `// @ts-expect-error` with a justification only when necessary).
- âœ… Never initialize empty state without a type (avoid `never[]`).

âœ… Correct:

```ts
let rows = $state<Row[]>([]);
```

---

## Non-negotiables (Runes only)

### 1) Props (`$props()`)

âŒ Legacy:

```svelte
<script lang="ts">
  export let title: string;
</script>
```

âœ… Strict:

```svelte
<script lang="ts">
  type Props = { title: string; subtitle?: string };
  let { title, subtitle }: Props = $props();
</script>
```

**Also forbidden:** `$$props` and `$$restProps` (use `$props()` destructuring instead).

---

### 2) State (`$state()`)

âŒ Legacy (non-reactive in runes mode):

```svelte
<script lang="ts">
  let count = 0;
</script>
```

âœ… Strict:

```svelte
<script lang="ts">
  let count = $state(0);
  let items = $state<string[]>([]);
</script>
```

---

### 3) Derived values (`$derived()`)

âŒ Legacy:

```svelte
<script lang="ts">
  $: total = a + b;
</script>
```

âœ… Strict:

```svelte
<script lang="ts">
  let total = $derived(a + b);
</script>
```

---

### 4) Side effects (`$effect()`)

âŒ Legacy:

- `onMount`
- `beforeUpdate` / `afterUpdate`

âœ… Strict:

```svelte
<script lang="ts">
  $effect(() => {
    // Runs after mount + after reactive updates
    console.log('total', total);

    return () => {
      // Cleanup
    };
  });
</script>
```

> If the effect must run _before_ paint, use `$effect.pre(...)`.

---

## Rendering and composition (Snippets)

âŒ Legacy:

- `<slot />`
- `<slot name="header" />`

âœ… Strict: snippets + `{@render ...}`

### Default children

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children } = $props<{ children?: Snippet }>();
</script>

{@render children?.()}
```

### Named snippets

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { header } = $props<{ header?: Snippet }>();
</script>

<header>{@render header?.()}</header>
```

> If you need snippet arguments, type them as `Snippet<[Arg1, Arg2]>`.

---

## Events

### DOM events

âœ… Prefer attribute events:

```svelte
<button onclick={save}>Save</button>
<input oninput={handleInput} />
```

âŒ Avoid:

```svelte
<button on:click={save}>Save</button>
```

### Component communication

âŒ Legacy:

- `createEventDispatcher`

âœ… Strict: callback props

#### Parent

```svelte
<Child onSave={(id) => save(id)} />
```

**Child**

```svelte
<script lang="ts">
  let { onSave } = $props<{ onSave: (id: string) => void }>();
</script>

<button onclick={() => onSave('123')}>Save</button>
```

---

## Server routes (`+server.ts`)

Requirements:

- Always return a `Response` (or use `json(...)`).
- Use `RequestHandler` types.
- Cloudflare bindings must be accessed via `platform.env` (never `process.env`).

âœ… Correct pattern:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.user) throw error(401, 'Unauthorized');

  const KV = platform?.env.KV;
  if (!KV) throw error(500, 'Storage unavailable');

  const key = `trip:${locals.user.id}:123`;
  const data = await KV.get(key);

  return json({ data });
};
```

---

## Definition of Done

Before committing, run:

```bash
npm run gate
```

This runs:

- `svelte-check` (type safety)
- `eslint` (strict rules)
- `vitest` (tests)

If any step fails, do not commit.

---

## Quick reference

| Feature          | Legacy (BANNED) âŒ      | Strict (REQUIRED) âœ…     |
| ---------------- | ----------------------- | ------------------------- |
| Props            | `export let x`          | `let { x } = $props()`    |
| State            | `let x = 0`             | `let x = $state(0)`       |
| Computed         | `$: y = x * 2`          | `let y = $derived(x * 2)` |
| Side effects     | `onMount`, `$:` blocks  | `$effect(() => ...)`      |
| Slots            | `<slot />`              | `{@render children?.()}`  |
| DOM events       | `on:click`              | `onclick`                 |
| Component events | `createEventDispatcher` | `onSave` callback prop    |
