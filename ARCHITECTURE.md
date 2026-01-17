# Architecture

## Target Architecture (Svelte 5)

- UI: Svelte 5 components
- State: `$state`, `$derived`
- Effects: `$effect`
- Events: callback props (no dispatchers)

## Migration Notes

- Components are migrated **one file at a time**
- A component must use **either** legacy Svelte 4 syntax **or** Svelte 5 runes — never both
- Legacy syntax is tolerated only until migration is complete

## Anti-patterns

- React hooks
- Svelte stores
- Lifecycle APIs (`onMount`, `beforeUpdate`, etc.)
- Framework-agnostic abstractions
