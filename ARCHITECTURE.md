# Architecture

This document defines the **enforced target architecture** for this repository.
It applies during and after the Svelte 4 → Svelte 5 migration.

---

## Target Architecture (Svelte 5)

### UI
- Svelte 5 components only
- No class-based components
- No framework-agnostic component layers

### State
- `$state` for local mutable state
- `$derived` for computed values
- No global or shared state abstractions by default

### Effects
- `$effect` for all side effects
- Effects must be:
  - deterministic
  - idempotent where possible
  - scoped to the component lifecycle implicitly

### Events & Communication
- Callback props only
- Standard DOM event attributes (`onclick`, etc.)
- ❌ No event dispatchers
- ❌ No custom event buses

---

## Migration Architecture Rules

During migration, the following rules are **strictly enforced**:

- Components are migrated **one file at a time**
- A component must use **either**:
  - legacy Svelte 4 syntax, **or**
  - Svelte 5 runes  
  **Never both**
- Legacy syntax is tolerated **only** when the file is explicitly marked:

```svelte
<!-- MIGRATION: SVELTE4-LEGACY -->
```

- Mixed syntax within a single file is forbidden
- New features must only be added to fully migrated Svelte 5 components

See:
- `MIGRATION.md`
- `SVELTE5_MIGRATION_COMPLIANCE.md`

---

## Explicit Non-Goals

The following are **out of scope** for this architecture:

- Cross-framework abstractions
- “Future-proof” indirection layers
- Shared UI logic designed to mimic React/Vue patterns
- Premature optimization via abstraction

---

## Anti-Patterns (Forbidden)

❌ React patterns:
- Hooks (`useEffect`, `useState`, etc.)
- Render props
- Context-heavy trees

❌ Svelte legacy patterns:
- `svelte/store`
- `$:` reactive labels
- `onMount`, `beforeUpdate`, `afterUpdate`
- `createEventDispatcher`

❌ Architectural smells:
- Framework-agnostic wrappers
- Custom state machines for UI state
- Event buses or pub/sub systems

---

## Enforcement

This architecture is enforced by:
- CI checks
- Linting rules
- Pre-commit hooks
- `AI_GUARD.md`

Violations are treated as **build-breaking errors**.
