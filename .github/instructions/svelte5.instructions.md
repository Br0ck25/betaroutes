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

## Quality bar

- Accessibility: proper labels, keyboard support where relevant.
- No placeholder UI or commented-out code.
