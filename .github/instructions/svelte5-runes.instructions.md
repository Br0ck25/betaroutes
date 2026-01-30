---
applyTo: '**/*.svelte'
---

# Svelte 5 (Runes) Strict Rules

## Forbidden

- `export let` (use `$props()`)
- `$:` reactive statements (use `$derived` / `$effect`)
- `createEventDispatcher` (use callback props)
- `$$props`, `$$restProps`
- `beforeUpdate`, `afterUpdate`
- `<slot>` (use snippets)

## Required style

- Keep components small and explicit.
- Prefer pure functions + typed helpers.
- No `any`. Use `unknown` and narrow.
- No lint/ts disables.

## Interaction safety

- Never render untrusted HTML.
- Avoid leaking sensitive data to the client.
