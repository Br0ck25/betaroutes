---
description: 'Svelte 5 (Runes) rules for .svelte files'
applyTo: '**/*.svelte'
---

## Svelte 5 only

- Use runes: `$props()`, `$state`, `$derived`, `$effect`.
- Never use: `export let`, `$:`, `createEventDispatcher`, `$$props`, `$$restProps`.

## Events

- Prefer `onclick={handler}` over `on:click={handler}` for DOM events.
- Use `on:` only when you need modifiers (once/capture/etc.) or forwarding.

## Components

- Props: destructure from `$props()` with types.
- State: `$state` for local mutable state.
- Derived: `$derived` must be side-effect free.
- Effects: `$effect` for side effects only.

## Type Safety (Strict)

- Always use `lang="ts"` if any TypeScript syntax is used
- No `any` types (use `unknown` and narrow with type guards)
- No `// @ts-ignore` (use `// @ts-expect-error` only with justification)
- Initialize typed state: `$state<Type[]>([])` not `$state([])`
- No implicit `never[]` types
- Handle `undefined` explicitly (TypeScript strict mode)

## HTML Standards

- No self-closing non-void elements: `<div />` is FORBIDDEN
- Use `<div></div>` instead
- Void elements (img, input, br, hr, meta, link) don't need closing: `<img src="..." alt="...">`
- Boolean attributes: use `disabled={condition}` not `disabled="true"`
- No mixing attribute styles: use either `onclick` or `on:click`, never both

## Security

- Never render untrusted HTML with `{@html}` without server-side sanitization
- Use security wrappers for IndexedDB: `getUserTrips(userId)` from `$lib/db/queries.ts`
- Never expose sensitive data in client-side state
- Use `csrfFetch` from `$lib/utils/csrf` for all mutations (POST/PUT/DELETE)

## Quality bar

- Accessibility: proper labels, ARIA attributes, keyboard support where relevant.
- No placeholder UI or commented-out code.
- Keep components small and focused (single responsibility).
- Extract reusable logic to composable functions.
